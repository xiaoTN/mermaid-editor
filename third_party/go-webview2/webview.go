//go:build windows
// +build windows

package webview2

import (
	"encoding/json"
	"errors"
	"log"
	"reflect"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2/internal/w32"
	"github.com/jchv/go-webview2/pkg/edge"

	"golang.org/x/sys/windows"
)

var (
	windowContext     = map[uintptr]interface{}{}
	windowContextSync sync.RWMutex
)

func getWindowContext(wnd uintptr) interface{} {
	windowContextSync.RLock()
	defer windowContextSync.RUnlock()
	return windowContext[wnd]
}

func setWindowContext(wnd uintptr, data interface{}) {
	windowContextSync.Lock()
	defer windowContextSync.Unlock()
	windowContext[wnd] = data
}

type browser interface {
	Embed(hwnd uintptr) bool
	Resize()
	Navigate(url string)
	NavigateToString(htmlContent string)
	Init(script string)
	Eval(script string)
	NotifyParentWindowPositionChanged() error
	Focus()
}

type webview struct {
	hwnd       uintptr
	mainthread uintptr
	browser    browser
	autofocus  bool
	maxsz      w32.Point
	minsz      w32.Point
	m          sync.Mutex
	bindings   map[string]interface{}
	secondary  bool
}

// gitdash patch: one dispatch queue shared by every window, so secondary
// windows created on the same UI thread get their bindings answered by the
// single Run loop. Secondary windows hide on close instead of quitting.
//
// Robustness (0.4.2): the queue is woken by a WM_APP posted to the main
// *window* (not the thread: thread messages are dropped by nested/modal
// loops such as Embed's or a window drag), drained on every message-loop
// iteration and by a 250 ms window timer, so a lost wake-up can only delay
// work, never strand it.
var (
	gqMu      sync.Mutex
	gq        []func()
	gqSince   time.Time // when the oldest queued item was added
	created   int
	mainHwnd  uintptr
	draining  bool  // UI thread only
	inBinding int32 // >0 while a binding runs inside a WebView2 callback
	quitting  atomic.Bool

	// OnHide is called after a secondary window is hidden by its close box.
	OnHide func(hwnd uintptr)
	// OnMainClose is called (UI thread) when the main window is about to be
	// destroyed; the host should destroy its secondary windows there.
	OnMainClose func()

	// Mermaid editor: the host can defer closing until the frontend has saved.
	// Called on the UI thread; queue modal UI with Dispatch, never nest it here.
	OnMainCloseRequested func() bool
	// OnDropFiles delivers native HDROP paths (UI thread).
	OnDropFiles func([]string)
	OnCopyData func(string)
	// Logf, when set, receives diagnostics (stalled queue, quit, ...).
	Logf func(format string, args ...interface{})
)

const drainTimerID = 0x6764 // "gd"

var (
	user32        = windows.NewLazySystemDLL("user32.dll")
	procSetTimer  = user32.NewProc("SetTimer")
	procPostMsg   = user32.NewProc("PostMessageW")
	procIsWindow  = user32.NewProc("IsWindow")
	setForeground = user32.NewProc("SetForegroundWindow")
)

func logf(format string, args ...interface{}) {
	if Logf != nil {
		Logf(format, args...)
	}
}

// QueueDepth reports how many dispatched functions are waiting and for how long the oldest has waited.
func QueueDepth() (int, time.Duration) {
	gqMu.Lock()
	defer gqMu.Unlock()
	if len(gq) == 0 {
		return 0, 0
	}
	return len(gq), time.Since(gqSince)
}

// Wake re-posts the queue's wake-up message (safe from any goroutine).
func Wake() {
	if mainHwnd != 0 {
		_, _, _ = procPostMsg.Call(mainHwnd, w32.WMApp, 0, 0)
	}
}

// drain runs the queued functions. UI thread only; never re-entrant and never
// inside a binding (a nested loop there would run with a WebView2 callback on the stack).
func drain() {
	if draining || atomic.LoadInt32(&inBinding) > 0 {
		return
	}
	gqMu.Lock()
	q := gq
	gq = nil
	gqMu.Unlock()
	if len(q) == 0 {
		return
	}
	draining = true
	defer func() { draining = false }()
	for _, v := range q {
		v()
	}
}

func init() {
	edge.EmbedPump = drain
}

// Quitting reports whether the main window has been closed.
func Quitting() bool { return quitting.Load() }

// DestroyWindow closes a webview's controller and destroys its window (UI thread).
func DestroyWindow(wv WebView) {
	w, ok := wv.(*webview)
	if !ok || w == nil {
		return
	}
	if c, ok := w.browser.(*edge.Chromium); ok {
		c.Close()
	}
	if r, _, _ := procIsWindow.Call(w.hwnd); r != 0 {
		_, _, _ = w32.User32DestroyWindow.Call(w.hwnd)
	}
}

// ShowWindow re-shows a hidden secondary window and brings it to front.
func ShowWindow(hwnd uintptr) {
	if w, ok := getWindowContext(hwnd).(*webview); ok {
		if c, ok := w.browser.(*edge.Chromium); ok {
			_ = c.Show()
		}
	}
	_, _, _ = w32.User32ShowWindow.Call(hwnd, 9 /* SW_RESTORE */)
	_, _, _ = w32.User32ShowWindow.Call(hwnd, w32.SWShow)
	setForeground.Call(hwnd)
}

type WindowOptions struct {
	Title  string
	Width  uint
	Height uint
	IconId uint
	Center bool
}

type WebViewOptions struct {
	Window unsafe.Pointer
	Debug  bool

	// DataPath specifies the datapath for the WebView2 runtime to use for the
	// browser instance.
	DataPath string

	// AutoFocus will try to keep the WebView2 widget focused when the window
	// is focused.
	AutoFocus bool

	// WindowOptions customizes the window that is created to embed the
	// WebView2 widget.
	WindowOptions WindowOptions
}

// New creates a new webview in a new window.
func New(debug bool) WebView { return NewWithOptions(WebViewOptions{Debug: debug}) }

// NewWindow creates a new webview using an existing window.
//
// Deprecated: Use NewWithOptions.
func NewWindow(debug bool, window unsafe.Pointer) WebView {
	return NewWithOptions(WebViewOptions{Debug: debug, Window: window})
}

// NewWithOptions creates a new webview using the provided options.
func NewWithOptions(options WebViewOptions) WebView {
	w := &webview{}
	created++
	w.secondary = created > 1
	w.bindings = map[string]interface{}{}
	w.autofocus = options.AutoFocus

	chromium := edge.NewChromium()
	chromium.MessageCallback = w.msgcb
	chromium.DataPath = options.DataPath
	chromium.SetPermission(edge.CoreWebView2PermissionKindClipboardRead, edge.CoreWebView2PermissionStateAllow)

	w.browser = chromium
	w.mainthread, _, _ = w32.Kernel32GetCurrentThreadID.Call()
	if !w.CreateWithOptions(options.WindowOptions) {
		return nil
	}

	settings, err := chromium.GetSettings()
	if err != nil {
		log.Fatal(err)
	}
	// disable context menu
	err = settings.PutAreDefaultContextMenusEnabled(options.Debug)
	if err != nil {
		log.Fatal(err)
	}
	// disable developer tools
	err = settings.PutAreDevToolsEnabled(options.Debug)
	if err != nil {
		log.Fatal(err)
	}

	return w
}

type rpcMessage struct {
	ID     int               `json:"id"`
	Method string            `json:"method"`
	Params []json.RawMessage `json:"params"`
}

func jsString(v interface{}) string { b, _ := json.Marshal(v); return string(b) }

func (w *webview) msgcb(msg string) {
	d := rpcMessage{}
	if err := json.Unmarshal([]byte(msg), &d); err != nil {
		log.Printf("invalid RPC message: %v", err)
		return
	}

	id := strconv.Itoa(d.ID)
	atomic.AddInt32(&inBinding, 1)
	res, err := w.callbinding(d)
	atomic.AddInt32(&inBinding, -1)
	if err != nil {
		w.Dispatch(func() {
			w.Eval("window._rpc[" + id + "].reject(" + jsString(err.Error()) + "); window._rpc[" + id + "] = undefined")
		})
	} else if b, err := json.Marshal(res); err != nil {
		w.Dispatch(func() {
			w.Eval("window._rpc[" + id + "].reject(" + jsString(err.Error()) + "); window._rpc[" + id + "] = undefined")
		})
	} else {
		w.Dispatch(func() {
			w.Eval("window._rpc[" + id + "].resolve(" + string(b) + "); window._rpc[" + id + "] = undefined")
		})
	}
}

func (w *webview) callbinding(d rpcMessage) (interface{}, error) {
	w.m.Lock()
	f, ok := w.bindings[d.Method]
	w.m.Unlock()
	if !ok {
		return nil, nil
	}

	v := reflect.ValueOf(f)
	isVariadic := v.Type().IsVariadic()
	numIn := v.Type().NumIn()
	if (isVariadic && len(d.Params) < numIn-1) || (!isVariadic && len(d.Params) != numIn) {
		return nil, errors.New("function arguments mismatch")
	}
	args := []reflect.Value{}
	for i := range d.Params {
		var arg reflect.Value
		if isVariadic && i >= numIn-1 {
			arg = reflect.New(v.Type().In(numIn - 1).Elem())
		} else {
			arg = reflect.New(v.Type().In(i))
		}
		if err := json.Unmarshal(d.Params[i], arg.Interface()); err != nil {
			return nil, err
		}
		args = append(args, arg.Elem())
	}

	errorType := reflect.TypeOf((*error)(nil)).Elem()
	res := v.Call(args)
	switch len(res) {
	case 0:
		// No results from the function, just return nil
		return nil, nil

	case 1:
		// One result may be a value, or an error
		if res[0].Type().Implements(errorType) {
			if res[0].Interface() != nil {
				return nil, res[0].Interface().(error)
			}
			return nil, nil
		}
		return res[0].Interface(), nil

	case 2:
		// Two results: first one is value, second is error
		if !res[1].Type().Implements(errorType) {
			return nil, errors.New("second return value must be an error")
		}
		if res[1].Interface() == nil {
			return res[0].Interface(), nil
		}
		return res[0].Interface(), res[1].Interface().(error)

	default:
		return nil, errors.New("unexpected number of return values")
	}
}

func wndproc(hwnd, msg, wp, lp uintptr) uintptr {
	if w, ok := getWindowContext(hwnd).(*webview); ok {
		switch msg {
		case w32.WMMove, w32.WMMoving:
			_ = w.browser.NotifyParentWindowPositionChanged()
		case w32.WMNCLButtonDown:
			_, _, _ = w32.User32SetFocus.Call(w.hwnd)
			r, _, _ := w32.User32DefWindowProcW.Call(hwnd, msg, wp, lp)
			return r
		case w32.WMSize:
			w.browser.Resize()
		case w32.WMActivate:
			// let DefWindowProc see activation too (keeps focus/UIA state consistent),
			// then hand focus to the browser.
			r, _, _ := w32.User32DefWindowProcW.Call(hwnd, msg, wp, lp)
			if wp&0xFFFF != w32.WAInactive && w.autofocus {
				w.browser.Focus()
			}
			return r
		case w32.WMApp:
			drain()
		case 0x0113: // WM_TIMER
			if wp == drainTimerID {
				if n, age := QueueDepth(); n > 0 && age > 3*time.Second {
					logf("dispatch: %d queued, oldest %v; draining from timer", n, age.Round(time.Millisecond))
				}
				drain()
				break
			}
			r, _, _ := w32.User32DefWindowProcW.Call(hwnd, msg, wp, lp)
			return r
		case w32.WMClose:
			if !w.secondary && OnMainCloseRequested != nil && !OnMainCloseRequested() {
				return 0
			}
			if w.secondary && !quitting.Load() {
				if c, ok := w.browser.(*edge.Chromium); ok {
					_ = c.Hide()
				}
				_, _, _ = w32.User32ShowWindow.Call(hwnd, 0 /* SW_HIDE */)
				if OnHide != nil {
					OnHide(hwnd)
				}
				return 0
			}
			if !w.secondary {
				// gitdash patch: closing the main window ends the app, hidden windows included.
				quitting.Store(true)
				logf("main window closing")
				if OnMainClose != nil {
					OnMainClose()
				}
			}
			if c, ok := w.browser.(*edge.Chromium); ok { c.Close() }
			_, _, _ = w32.User32DestroyWindow.Call(hwnd)
		case w32.WMDestroy:
			windowContextSync.Lock()
			delete(windowContext, hwnd)
			windowContextSync.Unlock()
			if !w.secondary {
				quitting.Store(true)
				w.Terminate()
			}
		case 0x0233: // WM_DROPFILES
			paths := droppedFiles(wp)
			if OnDropFiles != nil && len(paths) > 0 {
				OnDropFiles(paths)
			}
		case 0x004A: // WM_COPYDATA, second-instance file forwarding
			if OnCopyData != nil && lp != 0 {
				d := (*copyData)(unsafe.Pointer(lp))
				if d.Tag == 0x6d65 && d.Size > 0 && d.Size <= 65536 && d.Data != nil {
					OnCopyData(windows.UTF16ToString(unsafe.Slice(d.Data, int(d.Size)/2)))
				}
			}
			return 1
		case w32.WMGetMinMaxInfo:
			lpmmi := (*w32.MinMaxInfo)(unsafe.Pointer(lp))
			if w.maxsz.X > 0 && w.maxsz.Y > 0 {
				lpmmi.PtMaxSize = w.maxsz
				lpmmi.PtMaxTrackSize = w.maxsz
			}
			if w.minsz.X > 0 && w.minsz.Y > 0 {
				lpmmi.PtMinTrackSize = w.minsz
			}
		default:
			r, _, _ := w32.User32DefWindowProcW.Call(hwnd, msg, wp, lp)
			return r
		}
		return 0
	}
	r, _, _ := w32.User32DefWindowProcW.Call(hwnd, msg, wp, lp)
	return r
}

func (w *webview) Create(debug bool, window unsafe.Pointer) bool {
	// This function signature stopped making sense a long time ago.
	// It is but legacy cruft at this point.
	return w.CreateWithOptions(WindowOptions{})
}

func (w *webview) CreateWithOptions(opts WindowOptions) bool {
	var hinstance windows.Handle
	_ = windows.GetModuleHandleEx(0, nil, &hinstance)

	var icon uintptr
	if opts.IconId == 0 {
		// load default icon
		icow, _, _ := w32.User32GetSystemMetrics.Call(w32.SystemMetricsCxIcon)
		icoh, _, _ := w32.User32GetSystemMetrics.Call(w32.SystemMetricsCyIcon)
		icon, _, _ = w32.User32LoadImageW.Call(uintptr(hinstance), 32512, icow, icoh, 0)
	} else {
		// load icon from resource
		icon, _, _ = w32.User32LoadImageW.Call(uintptr(hinstance), uintptr(opts.IconId), 1, 0, 0, w32.LR_DEFAULTSIZE|w32.LR_SHARED)
	}

	className, _ := windows.UTF16PtrFromString("webview")
	wc := w32.WndClassExW{
		CbSize:        uint32(unsafe.Sizeof(w32.WndClassExW{})),
		HInstance:     hinstance,
		LpszClassName: className,
		HIcon:         windows.Handle(icon),
		HIconSm:       windows.Handle(icon),
		LpfnWndProc:   windows.NewCallback(wndproc),
	}
	_, _, _ = w32.User32RegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))

	windowName, _ := windows.UTF16PtrFromString(opts.Title)

	windowWidth := opts.Width
	if windowWidth == 0 {
		windowWidth = 640
	}
	windowHeight := opts.Height
	if windowHeight == 0 {
		windowHeight = 480
	}

	var posX, posY uint
	if opts.Center {
		// get screen size
		screenWidth, _, _ := w32.User32GetSystemMetrics.Call(w32.SM_CXSCREEN)
		screenHeight, _, _ := w32.User32GetSystemMetrics.Call(w32.SM_CYSCREEN)
		// calculate window position
		posX = (uint(screenWidth) - windowWidth) / 2
		posY = (uint(screenHeight) - windowHeight) / 2
	} else {
		// use default position
		posX = w32.CW_USEDEFAULT
		posY = w32.CW_USEDEFAULT
	}

	w.hwnd, _, _ = w32.User32CreateWindowExW.Call(
		0,
		uintptr(unsafe.Pointer(className)),
		uintptr(unsafe.Pointer(windowName)),
		0xCF0000, // WS_OVERLAPPEDWINDOW
		uintptr(posX),
		uintptr(posY),
		uintptr(windowWidth),
		uintptr(windowHeight),
		0,
		0,
		uintptr(hinstance),
		0,
	)
	setWindowContext(w.hwnd, w)
	if !w.secondary {
		mainHwnd = w.hwnd
		_, _, _ = procSetTimer.Call(w.hwnd, drainTimerID, 250, 0)
	}

	_, _, _ = w32.User32ShowWindow.Call(w.hwnd, w32.SWShow)
	_, _, _ = w32.User32UpdateWindow.Call(w.hwnd)
	_, _, _ = w32.User32SetFocus.Call(w.hwnd)

	if !w.browser.Embed(w.hwnd) {
		return false
	}
	w.browser.Resize()
	return true
}

func (w *webview) Destroy() {
	_, _, _ = w32.User32PostMessageW.Call(w.hwnd, w32.WMClose, 0, 0)
}

func (w *webview) Run() {
	var msg w32.Msg
	for {
		r, _, _ := w32.User32GetMessageW.Call(
			uintptr(unsafe.Pointer(&msg)),
			0,
			0,
			0,
		)
		if int32(r) == -1 {
			logf("GetMessage failed")
			return
		}
		if r == 0 || msg.Message == w32.WMQuit {
			logf("message loop: WM_QUIT")
			return
		}
		if msg.Message == w32.WMApp && msg.Hwnd == 0 {
			drain() // legacy thread-message wake-up
			continue
		}
		root, _, _ := w32.User32GetAncestor.Call(uintptr(msg.Hwnd), w32.GARoot)
		if d, _, _ := w32.User32IsDialogMessage.Call(root, uintptr(unsafe.Pointer(&msg))); d == 0 {
			_, _, _ = w32.User32TranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
			_, _, _ = w32.User32DispatchMessageW.Call(uintptr(unsafe.Pointer(&msg)))
		}
		drain() // every iteration: a lost wake-up never strands queued work
		if quitting.Load() && mainHwnd != 0 {
			if ok, _, _ := procIsWindow.Call(mainHwnd); ok == 0 {
				logf("message loop: main window gone")
				return
			}
		}
	}
}

func (w *webview) Terminate() {
	_, _, _ = w32.User32PostQuitMessage.Call(0)
}

func (w *webview) Window() unsafe.Pointer {
	return unsafe.Pointer(w.hwnd)
}

func (w *webview) Navigate(url string) {
	w.browser.Navigate(url)
}

func (w *webview) SetHtml(html string) {
	w.browser.NavigateToString(html)
}

func (w *webview) SetTitle(title string) {
	_title, err := windows.UTF16FromString(title)
	if err != nil {
		_title, _ = windows.UTF16FromString("")
	}
	_, _, _ = w32.User32SetWindowTextW.Call(w.hwnd, uintptr(unsafe.Pointer(&_title[0])))
}

func (w *webview) SetSize(width int, height int, hints Hint) {
	index := w32.GWLStyle
	style := w32.GetWindowLong(w.hwnd, index)
	if hints == HintFixed {
		style &^= (w32.WSThickFrame | w32.WSMaximizeBox)
	} else {
		style |= (w32.WSThickFrame | w32.WSMaximizeBox)
	}
	w32.SetWindowLong(w.hwnd, index, style)

	if hints == HintMax {
		w.maxsz.X = int32(width)
		w.maxsz.Y = int32(height)
	} else if hints == HintMin {
		w.minsz.X = int32(width)
		w.minsz.Y = int32(height)
	} else {
		r := w32.Rect{}
		r.Left = 0
		r.Top = 0
		r.Right = int32(width)
		r.Bottom = int32(height)
		_, _, _ = w32.User32AdjustWindowRect.Call(uintptr(unsafe.Pointer(&r)), w32.WSOverlappedWindow, 0)
		_, _, _ = w32.User32SetWindowPos.Call(
			w.hwnd, 0, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top),
			w32.SWPNoZOrder|w32.SWPNoActivate|w32.SWPNoMove|w32.SWPFrameChanged)
		w.browser.Resize()
	}
}

func (w *webview) Init(js string) {
	w.browser.Init(js)
}

func (w *webview) Eval(js string) {
	w.browser.Eval(js)
}

func (w *webview) Dispatch(f func()) {
	gqMu.Lock()
	if len(gq) == 0 {
		gqSince = time.Now()
	}
	gq = append(gq, f)
	gqMu.Unlock()
	if mainHwnd != 0 {
		_, _, _ = procPostMsg.Call(mainHwnd, w32.WMApp, 0, 0)
	} else {
		_, _, _ = w32.User32PostThreadMessageW.Call(w.mainthread, w32.WMApp, 0, 0)
	}
}

func (w *webview) Bind(name string, f interface{}) error {
	v := reflect.ValueOf(f)
	if v.Kind() != reflect.Func {
		return errors.New("only functions can be bound")
	}
	if n := v.Type().NumOut(); n > 2 {
		return errors.New("function may only return a value or a value+error")
	}
	w.m.Lock()
	w.bindings[name] = f
	w.m.Unlock()

	w.Init("(function() { var name = " + jsString(name) + ";" + `
		var RPC = window._rpc = (window._rpc || {nextSeq: 1});
		window[name] = function() {
		  var seq = RPC.nextSeq++;
		  var promise = new Promise(function(resolve, reject) {
			RPC[seq] = {
			  resolve: resolve,
			  reject: reject,
			};
		  });
		  window.external.invoke(JSON.stringify({
			id: seq,
			method: name,
			params: Array.prototype.slice.call(arguments),
		  }));
		  return promise;
		}
	})()`)

	return nil
}
