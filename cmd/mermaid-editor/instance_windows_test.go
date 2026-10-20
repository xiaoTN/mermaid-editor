//go:build windows

package main

import (
	"os"
	"strconv"
	"testing"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestSingleInstanceMutexDetectsExistingHandle(t *testing.T) {
	name, _ := windows.UTF16PtrFromString(`Local\mermaid-editor-test-` + strconv.Itoa(os.Getpid()))
	first, err := createInstanceMutex(name)
	if first == 0 || err != nil {
		t.Fatalf("first mutex: %v %v", first, err)
	}
	defer windows.CloseHandle(first)
	second, err := createInstanceMutex(name)
	if second == 0 || err != windows.ERROR_ALREADY_EXISTS {
		t.Fatalf("existing mutex not detected: %v %v", second, err)
	}
	defer windows.CloseHandle(second)
}

func TestNativeFileDialogLayout(t *testing.T) {
	if unsafe.Sizeof(openFileName{}) != 152 {
		t.Fatalf("OPENFILENAMEW size: %d", unsafe.Sizeof(openFileName{}))
	}
}
