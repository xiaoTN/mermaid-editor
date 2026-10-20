//go:build windows

package webview2

import (
	"errors"
	"unsafe"

	"github.com/jchv/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

var shell32 = windows.NewLazySystemDLL("shell32.dll")
var dragQuery = shell32.NewProc("DragQueryFileW")
var dragFinish = shell32.NewProc("DragFinish")
var dragAccept = shell32.NewProc("DragAcceptFiles")

type copyData struct {
	Tag  uintptr
	Size uint32
	Data *uint16
}

func droppedFiles(drop uintptr) []string {
	defer dragFinish.Call(drop)
	n, _, _ := dragQuery.Call(drop, 0xffffffff, 0, 0)
	paths := make([]string, 0, n)
	for i := uintptr(0); i < n; i++ {
		length, _, _ := dragQuery.Call(drop, i, 0, 0)
		buf := make([]uint16, length+1)
		dragQuery.Call(drop, i, uintptr(unsafe.Pointer(&buf[0])), length+1)
		paths = append(paths, windows.UTF16ToString(buf))
	}
	return paths
}

// EnableFileDrop enables Explorer drops; OLE drops are disabled in the controller.
func EnableFileDrop(w WebView) {
	dragAccept.Call(uintptr(w.Window()), 1)
	if view, ok := w.(*webview); ok {
		if c, ok := view.browser.(*edge.Chromium); ok {
			c.DisableExternalDrop()
		}
	}
}

// MapHost gives the embedded app a stable secure origin for drafts and SHA-256.
func MapHost(w WebView, host, folder string) error {
	view, ok := w.(*webview)
	if !ok {
		return errors.New("无法映射本地页面")
	}
	c, ok := view.browser.(*edge.Chromium)
	if !ok {
		return errors.New("无法映射本地页面")
	}
	v3 := c.GetICoreWebView2_3()
	if v3 == nil {
		return errors.New("请更新 Microsoft Edge WebView2 运行时")
	}
	return v3.SetVirtualHostNameToFolderMapping(host, folder, edge.COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY)
}
