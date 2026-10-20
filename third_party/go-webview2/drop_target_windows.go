//go:build windows

package webview2

import (
	"fmt"
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var dropOle = windows.NewLazySystemDLL("ole32.dll")
var nativeDrops = map[uintptr]*nativeDropTarget{} // COM keeps pointers; retain their Go allocations.

type nativeDropTarget struct {
	vtable *[7]uintptr
	accept bool
}
type dropDataObject struct{ vtable *[12]uintptr }
type dropFormat struct {
	format uint16
	device uintptr
	aspect uint32
	index  int32
	medium uint32
}
type dropMedium struct {
	kind    uint32
	handle  uintptr
	release uintptr
}

func fileDropFormat() dropFormat { return dropFormat{format: 15, aspect: 1, index: -1, medium: 1} } // CF_HDROP, TYMED_HGLOBAL

func acceptsDrop(data *dropDataObject) bool {
	if data == nil {
		return false
	}
	format := fileDropFormat()
	hr, _, _ := syscall.SyscallN(data.vtable[5], uintptr(unsafe.Pointer(data)), uintptr(unsafe.Pointer(&format))) // QueryGetData
	return hr == 0
}

func enterDrop(target *nativeDropTarget, data *dropDataObject, effect *uint32) uintptr {
	target.accept = acceptsDrop(data)
	if effect != nil {
		if target.accept {
			*effect &= 1
		} else {
			*effect = 0
		}
	}
	return 0
}
func overDrop(target *nativeDropTarget, effect *uint32) uintptr {
	if effect != nil {
		if target.accept {
			*effect &= 1
		} else {
			*effect = 0
		}
	}
	return 0
}
func finishDrop(target *nativeDropTarget, data *dropDataObject, effect *uint32) uintptr {
	if effect != nil {
		*effect = 0
	}
	if !acceptsDrop(data) {
		return 0
	}
	format := fileDropFormat()
	medium := dropMedium{}
	hr, _, _ := syscall.SyscallN(data.vtable[3], uintptr(unsafe.Pointer(data)), uintptr(unsafe.Pointer(&format)), uintptr(unsafe.Pointer(&medium))) // GetData
	if hr != 0 {
		return hr
	}
	defer dropOle.NewProc("ReleaseStgMedium").Call(uintptr(unsafe.Pointer(&medium)))
	if medium.kind != 1 || medium.handle == 0 {
		return 0
	}
	paths := queryDroppedFiles(medium.handle)
	if len(paths) > 0 && OnDropFiles != nil {
		OnDropFiles(paths)
		if effect != nil {
			*effect = 1
		}
	}
	target.accept = false
	return 0
}

func registerNativeDrop(hwnd uintptr) error {
	hr, _, _ := dropOle.NewProc("OleInitialize").Call(0)
	if int32(hr) < 0 {
		return fmt.Errorf("OleInitialize: HRESULT 0x%x", hr)
	}
	target := &nativeDropTarget{vtable: &[7]uintptr{}}
	iunknown, _ := windows.GUIDFromString("{00000000-0000-0000-C000-000000000046}")
	idrop, _ := windows.GUIDFromString("{00000122-0000-0000-C000-000000000046}")
	target.vtable[0] = syscall.NewCallback(func(self *nativeDropTarget, iid *windows.GUID, out **nativeDropTarget) uintptr {
		*out = nil
		if *iid != iunknown && *iid != idrop {
			return 0x80004002
		}
		*out = self
		return 0
	})
	target.vtable[1] = syscall.NewCallback(func(_ *nativeDropTarget) uintptr { return 1 })
	target.vtable[2] = syscall.NewCallback(func(_ *nativeDropTarget) uintptr { return 1 })
	target.vtable[5] = syscall.NewCallback(func(self *nativeDropTarget) uintptr { self.accept = false; return 0 })
	// POINTL is passed as one 64-bit value on amd64/arm64 and two words on 386.
	if runtime.GOARCH == "386" {
		target.vtable[3] = syscall.NewCallback(func(self *nativeDropTarget, data *dropDataObject, key, x, y uintptr, effect *uint32) uintptr {
			return enterDrop(self, data, effect)
		})
		target.vtable[4] = syscall.NewCallback(func(self *nativeDropTarget, key, x, y uintptr, effect *uint32) uintptr { return overDrop(self, effect) })
		target.vtable[6] = syscall.NewCallback(func(self *nativeDropTarget, data *dropDataObject, key, x, y uintptr, effect *uint32) uintptr {
			return finishDrop(self, data, effect)
		})
	} else {
		target.vtable[3] = syscall.NewCallback(func(self *nativeDropTarget, data *dropDataObject, key, point uintptr, effect *uint32) uintptr {
			return enterDrop(self, data, effect)
		})
		target.vtable[4] = syscall.NewCallback(func(self *nativeDropTarget, key, point uintptr, effect *uint32) uintptr {
			return overDrop(self, effect)
		})
		target.vtable[6] = syscall.NewCallback(func(self *nativeDropTarget, data *dropDataObject, key, point uintptr, effect *uint32) uintptr {
			return finishDrop(self, data, effect)
		})
	}
	hr, _, _ = dropOle.NewProc("RegisterDragDrop").Call(hwnd, uintptr(unsafe.Pointer(target)))
	if hr != 0 {
		dropOle.NewProc("OleUninitialize").Call()
		return fmt.Errorf("RegisterDragDrop: HRESULT 0x%x", hr)
	}
	nativeDrops[hwnd] = target
	return nil
}

func revokeNativeDrop(hwnd uintptr) {
	if nativeDrops[hwnd] != nil {
		dropOle.NewProc("RevokeDragDrop").Call(hwnd)
		delete(nativeDrops, hwnd)
		dropOle.NewProc("OleUninitialize").Call()
	}
}
