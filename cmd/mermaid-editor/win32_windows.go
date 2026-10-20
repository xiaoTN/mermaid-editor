//go:build windows

package main

import (
	"errors"
	"path/filepath"
	"runtime"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	shell32  = syscall.NewLazyDLL("shell32.dll")
	ole32    = syscall.NewLazyDLL("ole32.dll")

	pMessageBoxW          = user32.NewProc("MessageBoxW")
	pOpenClipboard        = user32.NewProc("OpenClipboard")
	pCloseClipboard       = user32.NewProc("CloseClipboard")
	pEmptyClipboard       = user32.NewProc("EmptyClipboard")
	pSetClipboardData     = user32.NewProc("SetClipboardData")
	pGlobalAlloc          = kernel32.NewProc("GlobalAlloc")
	pGlobalLock           = kernel32.NewProc("GlobalLock")
	pGlobalUnlock         = kernel32.NewProc("GlobalUnlock")
	pGlobalFree           = kernel32.NewProc("GlobalFree")
	pCopyMemory           = kernel32.NewProc("RtlMoveMemory")
	pSHBrowseForFolderW   = shell32.NewProc("SHBrowseForFolderW")
	pSHGetPathFromIDListW = shell32.NewProc("SHGetPathFromIDListW")
	pCoTaskMemFree        = ole32.NewProc("CoTaskMemFree")
	pGetOpenFileNameW     = syscall.NewLazyDLL("comdlg32.dll").NewProc("GetOpenFileNameW")
	pGetSaveFileNameW     = syscall.NewLazyDLL("comdlg32.dll").NewProc("GetSaveFileNameW")
	pCommDlgExtendedError = syscall.NewLazyDLL("comdlg32.dll").NewProc("CommDlgExtendedError")
	pSetWindowsHookExW    = user32.NewProc("SetWindowsHookExW")
	pUnhookWindowsHookEx  = user32.NewProc("UnhookWindowsHookEx")
	pCallNextHookEx       = user32.NewProc("CallNextHookEx")
	pSetDlgItemTextW      = user32.NewProc("SetDlgItemTextW")
	pGetCurrentThreadId   = kernel32.NewProc("GetCurrentThreadId")
)

func showFatal(msg string) {
	t, _ := syscall.UTF16PtrFromString(msg)
	c, _ := syscall.UTF16PtrFromString("Mermaid 编辑器")
	pMessageBoxW.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), 0x10)
}

// OPENFILENAMEW uses native alignment (152 bytes on Windows amd64).
type openFileName struct {
	Size                         uint32
	Owner, Instance              uintptr
	Filter, CustomFilter         *uint16
	MaxCustomFilter, FilterIndex uint32
	File                         *uint16
	MaxFile                      uint32
	FileTitle                    *uint16
	MaxFileTitle                 uint32
	InitialDir, Title            *uint16
	Flags                        uint32
	FileOffset, FileExtension    uint16
	DefaultExtension             *uint16
	CustomData, Hook             uintptr
	Template                     *uint16
	Reserved                     uintptr
	Reserved2, FlagsEx           uint32
}

// pickFile must only run inside Dispatch, after a binding callback has returned.
func pickFile(hwnd uintptr, save bool, name, filterLabel string) (string, error) {
	buf := make([]uint16, 32768)
	if save {
		copy(buf, utf16.Encode([]rune(filepath.Base(name))))
	}
	filter := utf16.Encode([]rune(filterLabel + " (*.mmd;*.mermaid;*.md;*.txt)\x00*.mmd;*.mermaid;*.md;*.txt\x00\x00"))
	ext, _ := syscall.UTF16PtrFromString("mmd")
	of := openFileName{Size: uint32(unsafe.Sizeof(openFileName{})), Owner: hwnd,
		Filter: &filter[0], FilterIndex: 1, File: &buf[0], MaxFile: uint32(len(buf)),
		DefaultExtension: ext, Flags: 0x80000 | 0x800 | 0x8 /* EXPLORER|PATHMUSTEXIST|NOCHANGEDIR */}
	proc := pGetOpenFileNameW
	if save {
		proc = pGetSaveFileNameW
		of.Flags |= 0x2 /* OVERWRITEPROMPT */
	} else {
		of.Flags |= 0x1000 /* FILEMUSTEXIST */
	}
	r, _, _ := proc.Call(uintptr(unsafe.Pointer(&of)))
	runtime.KeepAlive(filter)
	if r != 0 {
		return syscall.UTF16ToString(buf), nil
	}
	if code, _, _ := pCommDlgExtendedError.Call(); code != 0 {
		return "", errors.New("无法显示系统文件对话框（错误 " + itoa(code) + "）")
	}
	return "", nil
}

type closeLabels struct {
	Title    string `json:"title"`
	Body     string `json:"body"`
	Save     string `json:"save"`
	DontSave string `json:"dontSave"`
	Cancel   string `json:"cancel"`
}

// A thread-scoped CBT hook gives the system MessageBox its product labels.
func confirmClose(hwnd uintptr, labels closeLabels) string {
	thread, _, _ := pGetCurrentThreadId.Call()
	callback := syscall.NewCallback(func(code int32, wp, lp uintptr) uintptr {
		if code == 5 { // HCBT_ACTIVATE
			for id, label := range map[uintptr]string{6: labels.Save, 7: labels.DontSave, 2: labels.Cancel} {
				text, _ := syscall.UTF16PtrFromString(label)
				pSetDlgItemTextW.Call(wp, id, uintptr(unsafe.Pointer(text)))
			}
		}
		r, _, _ := pCallNextHookEx.Call(0, uintptr(code), wp, lp)
		return r
	})
	hook, _, _ := pSetWindowsHookExW.Call(5, callback, 0, thread)
	if hook == 0 {
		return "cancel"
	}
	defer pUnhookWindowsHookEx.Call(hook)
	body, _ := syscall.UTF16PtrFromString(labels.Body)
	title, _ := syscall.UTF16PtrFromString(labels.Title)
	r, _, _ := pMessageBoxW.Call(hwnd, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), 0x3|0x30|0x000 /* YESNOCANCEL|WARNING|DEFBUTTON1 (Save) */)
	if r == 6 {
		return "save"
	}
	if r == 7 {
		return "discard"
	}
	return "cancel"
}

func forwardFile(hwnd uintptr, path string) {
	path, err := filepath.Abs(path)
	if err != nil {
		return
	}
	buf, err := syscall.UTF16FromString(path)
	if err != nil {
		return
	}
	data := struct {
		Tag  uintptr
		Size uint32
		Data *uint16
	}{0x6d65, uint32(len(buf) * 2), &buf[0]}
	var result uintptr
	user32.NewProc("SendMessageTimeoutW").Call(hwnd, 0x004A, 0, uintptr(unsafe.Pointer(&data)), 0x2, 1500, uintptr(unsafe.Pointer(&result)))
	runtime.KeepAlive(buf)
}

// setClipboard puts text on the Windows clipboard.
func setClipboard(hwnd uintptr, s string) error {
	u := utf16.Encode([]rune(s + "\x00"))
	size := uintptr(len(u) * 2)
	const gmemMoveable = 0x0002
	const cfUnicodeText = 13
	if r, _, _ := pOpenClipboard.Call(hwnd); r == 0 {
		return errors.New("无法打开剪贴板")
	}
	defer pCloseClipboard.Call()
	pEmptyClipboard.Call()
	h, _, _ := pGlobalAlloc.Call(gmemMoveable, size)
	if h == 0 {
		return errors.New("内存不足")
	}
	ptr, _, _ := pGlobalLock.Call(h)
	if ptr == 0 {
		pGlobalFree.Call(h)
		return errors.New("内存不足")
	}
	pCopyMemory.Call(ptr, uintptr(unsafe.Pointer(&u[0])), size)
	runtime.KeepAlive(u)
	pGlobalUnlock.Call(h)
	if r, _, _ := pSetClipboardData.Call(cfUnicodeText, h); r == 0 {
		pGlobalFree.Call(h)
		return errors.New("写入剪贴板失败")
	}
	return nil
}
