//go:build windows

package main

import (
	_ "embed"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"time"

	webview2 "github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/webviewloader"
	"github.com/xiaoti/mermaid-editor/internal/applog"
	"github.com/xiaoti/mermaid-editor/internal/files"
)

const version = "0.1.0"

//go:embed index.html
var indexHTML string

type app struct {
	w           webview2.WebView
	ready       bool
	allowClose  bool
	pendingPath string
}

type reply struct {
	ID    int    `json:"id"`
	Value any    `json:"value"`
	Error string `json:"error,omitempty"`
}

func (a *app) emit(value any) {
	data, _ := json.Marshal(value)
	a.w.Dispatch(func() { a.w.Eval("window.onMe && window.onMe(" + string(data) + ")") })
}

func (a *app) answer(id int, value any, err error) {
	r := reply{ID: id, Value: value}
	if err != nil {
		r.Error = err.Error()
		applog.Printf("request %d failed: %v", id, err)
	}
	a.emit(r)
}

func (a *app) hwnd() uintptr { return uintptr(a.w.Window()) }

func (a *app) openPath(path string) {
	if !files.Supported(path) {
		return
	}
	if !a.ready {
		a.pendingPath = path
		return
	}
	a.emit(map[string]any{"type": "open", "path": path})
}

// Copied from gitdash: diagnose and re-wake the shared dispatch queue.
func watchQueue() {
	for range time.Tick(5 * time.Second) {
		if n, age := webview2.QueueDepth(); n > 0 && age > 5*time.Second {
			applog.Printf("dispatch queue stalled: %d items, oldest %v; re-posting wake-up", n, age.Round(time.Millisecond))
			webview2.Wake()
		}
	}
}

func (a *app) bind() {
	bind := func(name string, handler any) {
		if err := a.w.Bind(name, handler); err != nil {
			panic(err)
		}
	}
	// Bindings only enqueue work. Native modal loops must never run on a
	// WebView2 binding callback stack; gitdash's drain guard enforces this.
	bind("meOpen", func(id int, path, filter string) {
		a.w.Dispatch(func() {
			var err error
			if path == "" {
				path, err = pickFile(a.hwnd(), false, "", filter)
			}
			if err != nil || path == "" {
				a.answer(id, nil, err)
				return
			}
			doc, err := files.Read(path)
			applog.Printf("open %s", path)
			a.answer(id, doc, err)
		})
	})
	save := func(id int, doc files.Document, filter string, saveAs bool) {
		a.w.Dispatch(func() {
			path := doc.Path
			var err error
			if saveAs || doc.Untitled || !filepath.IsAbs(path) {
				path, err = pickFile(a.hwnd(), true, doc.Name, filter)
			}
			if err != nil || path == "" {
				a.answer(id, nil, err)
				return
			}
			saved, err := files.Save(doc, path)
			applog.Printf("save %s", path)
			a.answer(id, saved, err)
		})
	}
	bind("meSave", func(id int, doc files.Document, filter string) { save(id, doc, filter, false) })
	bind("meSaveAs", func(id int, doc files.Document, filter string) { save(id, doc, filter, true) })
	bind("meCopy", func(text string) error { return setClipboard(a.hwnd(), text) })
	bind("meLog", func(message string) { applog.Printf("js: %s", message) })
	bind("meState", func(title string) { a.w.Dispatch(func() { a.w.SetTitle(title) }) })
	bind("meConfirmClose", func(id int, labels closeLabels) {
		a.w.Dispatch(func() { a.answer(id, confirmClose(a.hwnd(), labels), nil) })
	})
	bind("meFinishClose", func() {
		a.w.Dispatch(func() { a.allowClose = true; a.w.Destroy() })
	})
	bind("meReady", func() {
		a.w.Dispatch(func() {
			if a.ready {
				return
			}
			a.ready = true
			applog.Printf("frontend ready")
			if a.pendingPath != "" {
				path := a.pendingPath
				a.pendingPath = ""
				a.openPath(path)
			}
		})
	})
}

func main() {
	_ = applog.Open(filepath.Join(dataDir(), "mermaid-editor.log"))
	log.SetOutput(logWriter{})
	exe, _ := os.Executable()
	applog.Printf("mermaid-editor %s starting (%s)", version, exe)
	defer func() {
		if r := recover(); r != nil {
			applog.Printf("panic: %v", r)
			showFatal("启动失败，请查看日志：\n" + applog.Path())
			exitNow(1)
		}
	}()
	proceed, private := singleInstance()
	if !proceed {
		exitNow(0)
	}
	installed, err := webviewloader.GetInstalledVersion()
	if err != nil || installed == "" {
		applog.Printf("WebView2 unavailable: %v", err)
		showFatal("无法打开窗口：这台电脑缺少 Microsoft Edge WebView2 运行时。\n请从微软官网下载安装「WebView2 Runtime」后再打开 Mermaid 编辑器。")
		exitNow(1)
	}
	webview2.Logf = func(format string, args ...any) { applog.Printf("webview: "+format, args...) }
	go watchQueue()
	dataPath := webviewDataPath(private)
	applog.Printf("WebView2 %s data: %s", installed, dataPath)
	w := webview2.NewWithOptions(webview2.WebViewOptions{AutoFocus: true, DataPath: dataPath,
		WindowOptions: webview2.WindowOptions{Title: "Mermaid 编辑器 — 未命名.mmd", Width: 1280, Height: 800, Center: true}})
	if w == nil {
		showFatal("无法打开 Mermaid 编辑器，请检查 Microsoft Edge WebView2 运行时。\n日志：" + applog.Path())
		exitNow(1)
	}
	a := &app{w: w}
	if len(os.Args) > 1 {
		a.pendingPath, _ = filepath.Abs(os.Args[1])
	}
	webview2.OnMainCloseRequested = func() bool {
		if a.allowClose || !a.ready {
			return true
		}
		a.emit(map[string]string{"type": "close"})
		return false
	}
	webview2.OnDropFiles = func(paths []string) {
		for _, path := range paths {
			if files.Supported(path) {
				a.openPath(path)
				break
			}
		}
	}
	webview2.OnCopyData = a.openPath
	webview2.EnableFileDrop(w)
	w.SetSize(640, 420, webview2.HintMin)
	a.bind()
	startup, _ := json.Marshal(a.pendingPath)
	w.Init("window.meStartupPath=" + string(startup) + "; window.addEventListener('error', e => window.meLog(String(e.message))); window.addEventListener('unhandledrejection', e => window.meLog(String(e.reason)));")
	// NavigateToString has a 2 MiB limit and an opaque origin. Extract the
	// embedded single file, then map a stable HTTPS origin for persistent drafts.
	assets := filepath.Join(dataDir(), "app")
	if err := os.MkdirAll(assets, 0700); err != nil {
		panic(err)
	}
	if err := os.WriteFile(filepath.Join(assets, "index.html"), []byte(indexHTML), 0600); err != nil {
		panic(err)
	}
	if err := webview2.MapHost(w, "mermaid-editor.local", assets); err != nil {
		panic(err)
	}
	w.Navigate("https://mermaid-editor.local/index.html")
	w.Run()
	applog.Printf("main window closed")
	exitNow(0)
}

type logWriter struct{}

func (logWriter) Write(data []byte) (int, error) { applog.Printf("%s", data); return len(data), nil }
func itoa(n uintptr) string                      { return strconv.FormatUint(uint64(n), 10) }
