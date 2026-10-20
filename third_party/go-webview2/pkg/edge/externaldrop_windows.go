//go:build windows

package edge

import "unsafe"

// ICoreWebView2Controller4 extends Controller3: vtable slots 36/37 are
// get_AllowExternalDrop/put_AllowExternalDrop. Release the queried interface.
func (e *Chromium) DisableExternalDrop() {
	if e.controller == nil {
		return
	}
	var controller *struct{ Vtable *[38]ComProc }
	iid := NewGUID("{97D418D5-A426-4E49-A151-E1A10F327D9E}")
	e.controller.vtbl.QueryInterface.Call(uintptr(unsafe.Pointer(e.controller)), uintptr(unsafe.Pointer(iid)), uintptr(unsafe.Pointer(&controller)))
	if controller == nil {
		return
	}
	controller.Vtable[37].Call(uintptr(unsafe.Pointer(controller)), 0)
	controller.Vtable[2].Call(uintptr(unsafe.Pointer(controller)))
}
