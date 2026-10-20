//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/xiaoti/mermaid-editor/internal/applog"
)

// dataDir is %LOCALAPPDATA%\mermaid-editor: log, pid file, WebView2 user data.
func dataDir() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = os.TempDir()
	}
	return filepath.Join(base, "mermaid-editor")
}

func pidFile() string { return filepath.Join(dataDir(), "mermaid-editor.pid") }

var (
	pCreateMutexW               = kernel32.NewProc("CreateMutexW")
	instanceMutex               windows.Handle
	pEnumWindows                = user32.NewProc("EnumWindows")
	pGetWindowThreadProcessId   = user32.NewProc("GetWindowThreadProcessId")
	pIsWindowVisible            = user32.NewProc("IsWindowVisible")
	pIsIconic                   = user32.NewProc("IsIconic")
	pGetClassNameW              = user32.NewProc("GetClassNameW")
	pShowWindow                 = user32.NewProc("ShowWindow")
	pSetForegroundWindow        = user32.NewProc("SetForegroundWindow")
	pQueryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")
)

// windowsOf lists the top-level "webview" windows of process pid.
func windowsOf(pid uint32) (visible, all []uintptr) {
	cb := syscall.NewCallback(func(h, _ uintptr) uintptr {
		var p uint32
		pGetWindowThreadProcessId.Call(h, uintptr(unsafe.Pointer(&p)))
		if p != pid {
			return 1
		}
		buf := make([]uint16, 64)
		pGetClassNameW.Call(h, uintptr(unsafe.Pointer(&buf[0])), 64)
		if syscall.UTF16ToString(buf) != "webview" {
			return 1
		}
		all = append(all, h)
		if v, _, _ := pIsWindowVisible.Call(h); v != 0 {
			visible = append(visible, h)
		} else if ic, _, _ := pIsIconic.Call(h); ic != 0 {
			visible = append(visible, h)
		}
		return 1
	})
	pEnumWindows.Call(cb, 0)
	return
}

func processImage(h windows.Handle) string {
	buf := make([]uint16, windows.MAX_PATH)
	n := uint32(len(buf))
	if r, _, _ := pQueryFullProcessImageNameW.Call(uintptr(h), 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n))); r == 0 {
		return ""
	}
	return windows.UTF16ToString(buf[:n])
}

func askYesNo(msg string) bool {
	t, _ := syscall.UTF16PtrFromString(msg)
	c, _ := syscall.UTF16PtrFromString("mermaid-editor")
	r, _, _ := pMessageBoxW.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x04|0x30|0x100 /* YESNO|WARNING|DEFBUTTON2 */)
	return r == 6 // IDYES
}

// singleInstance makes sure only one mermaid-editor GUI runs. It returns false when
// this process should exit (an existing, healthy instance was brought to
// front). When the previous instance is a windowless leftover it offers to end
// it; if the user declines, privateData is set so we don't share its WebView2
// user-data folder.
func singleInstance() (proceed bool, privateData bool) {
	name, _ := windows.UTF16PtrFromString(`Local\mermaid-editor-gui-single-instance`)
	h, err := createInstanceMutex(name)
	instanceMutex = h // retain ownership for the process lifetime
	if h == 0 {
		applog.Printf("single instance mutex unavailable: %v; using private data", err)
		return true, true
	}
	if err != windows.ERROR_ALREADY_EXISTS {
		_ = h // keep the mutex for the lifetime of the process
		writePid()
		return true, false
	}
	b, _ := os.ReadFile(pidFile())
	pid64, _ := strconv.ParseUint(strings.TrimSpace(string(b)), 10, 32)
	pid := uint32(pid64)
	applog.Printf("another instance holds the mutex (pid file says %d)", pid)
	if pid == 0 || pid == uint32(os.Getpid()) {
		writePid()
		return true, true
	}
	if vis, _ := windowsOf(pid); len(vis) > 0 {
		applog.Printf("bringing existing instance %d to front", pid)
		pShowWindow.Call(vis[0], 9 /* SW_RESTORE */)
		pSetForegroundWindow.Call(vis[0])
		if len(os.Args) > 1 {
			forwardFile(vis[0], os.Args[1])
		}
		return false, false
	}
	ph, err := windows.OpenProcess(windows.PROCESS_TERMINATE|windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.SYNCHRONIZE, false, pid)
	if err != nil {
		applog.Printf("pid %d not openable (%v); continuing with private WebView2 data", pid, err)
		writePid()
		return true, true
	}
	defer windows.CloseHandle(ph)
	img := processImage(ph)
	if !strings.Contains(strings.ToLower(filepath.Base(img)), "mermaid-editor") && !strings.Contains(filepath.Base(img), "Mermaid编辑器") {
		applog.Printf("pid %d is %q, not mermaid-editor; continuing", pid, img)
		writePid()
		return true, true
	}
	if askYesNo("发现一个没有窗口的旧 mermaid-editor 进程还在运行（PID " + strconv.Itoa(int(pid)) + "，" + filepath.Base(img) + "），\n可能是上次关闭时没有退出干净，它会占用资源、让新窗口卡住。\n\n结束这个旧进程后继续打开吗？\n（选「否」也会继续打开，但两个进程互不共享数据）") {
		err := windows.TerminateProcess(ph, 1)
		applog.Printf("terminated leftover instance %d (%s): %v", pid, img, err)
		windows.WaitForSingleObject(ph, 3000)
		writePid()
		return true, false
	}
	applog.Printf("user kept leftover instance %d; using private WebView2 data", pid)
	writePid()
	return true, true
}

// The pinned x/sys version discards ERROR_ALREADY_EXISTS when the returned
// handle is nonzero. Read CreateMutexW's last-error directly instead.
func createInstanceMutex(name *uint16) (windows.Handle, error) {
	h, _, err := pCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if h == 0 || err == windows.ERROR_ALREADY_EXISTS {
		return windows.Handle(h), err
	}
	return windows.Handle(h), nil
}

func writePid() {
	os.MkdirAll(dataDir(), 0o755)
	os.WriteFile(pidFile(), []byte(strconv.Itoa(os.Getpid())), 0o644)
}

// webviewDataPath picks the WebView2 user-data folder (never shared with a leftover process).
func webviewDataPath(private bool) string {
	if private {
		return filepath.Join(dataDir(), "WebView2-"+strconv.Itoa(os.Getpid()))
	}
	return filepath.Join(dataDir(), "WebView2")
}

// exitNow ends the process without running DLL detach code (WebView2 can hang
// ExitProcess while controllers or hidden windows are around).
func exitNow(code int) {
	applog.Printf("exit %d", code)
	applog.Close()
	done := make(chan struct{})
	go func() {
		windows.TerminateProcess(windows.CurrentProcess(), uint32(code))
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
	}
	os.Exit(code)
}
