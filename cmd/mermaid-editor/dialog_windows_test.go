//go:build windows

package main

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
	"unsafe"
)

func TestNativeFileFilters(t *testing.T) {
	for _, all := range []string{"所有文件 (*.*)", "All files (*.*)"} {
		filter := string(syscall.UTF16ToString(fileFilter("Mermaid", all)))
		if !strings.HasPrefix(filter, "Mermaid") {
			t.Fatal(filter)
		}
		// UTF16ToString stops at the first NUL; inspect all segments separately.
		runes := fileFilter("Mermaid", all)
		var parts []string
		start := 0
		for i, c := range runes {
			if c == 0 {
				parts = append(parts, syscall.UTF16ToString(runes[start:i]))
				start = i + 1
			}
		}
		if len(parts) != 5 || parts[1] != "*.mmd;*.mermaid;*.md;*.txt" || parts[2] != all || parts[3] != "*.*" || parts[4] != "" {
			t.Fatal(parts)
		}
	}
}

// Exercise the actual system MessageBox + product label hook on its owning STA.
// A helper only addresses the uniquely titled test dialog and clicks its button.
func TestNativeConfirmationDecisionsAndDefault(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	for locale, labels := range map[string][]string{"zh": {"保存", "不保存", "取消", "覆盖", "重新载入"}, "en": {"Save", "Don't save", "Cancel", "Overwrite", "Reload"}} {
		for _, conflict := range []bool{false, true} {
			for _, selected := range []uintptr{6, 7, 2} {
				title := fmt.Sprintf("mermaid-test-%d-%s-%v-%d", os.Getpid(), locale, conflict, selected)
				first, second, expectedDefault := labels[0], labels[1], uintptr(6)
				want := map[uintptr]string{6: "save", 7: "discard", 2: "cancel"}[selected]
				if conflict {
					first, second, expectedDefault = labels[3], labels[4], 2
					want = map[uintptr]string{6: "overwrite", 7: "reload", 2: "cancel"}[selected]
				}
				result := make(chan error, 1)
				go func() {
					name, _ := syscall.UTF16PtrFromString(title)
					var hwnd uintptr
					for end := time.Now().Add(5 * time.Second); time.Now().Before(end); time.Sleep(10 * time.Millisecond) {
						hwnd, _, _ = user32.NewProc("FindWindowW").Call(0, uintptr(unsafe.Pointer(name)))
						if hwnd != 0 {
							break
						}
					}
					if hwnd == 0 {
						result <- fmt.Errorf("test dialog not found")
						return
					}
					// Activation hook has set the button labels by this point.
					time.Sleep(25 * time.Millisecond)
					var problem error
					for id, text := range map[uintptr]string{6: first, 7: second, 2: labels[2]} {
						buf := make([]uint16, 100)
						user32.NewProc("GetDlgItemTextW").Call(hwnd, id, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
						if got := syscall.UTF16ToString(buf); got != text {
							problem = fmt.Errorf("button %d: %q != %q", id, got, text)
						}
					}
					def, _, _ := user32.NewProc("SendMessageW").Call(hwnd, 0x400, 0, 0) // DM_GETDEFID
					if def&0xffff != expectedDefault {
						problem = fmt.Errorf("default button: %x, want %d", def, expectedDefault)
					}
					user32.NewProc("PostMessageW").Call(hwnd, 0x111, selected, 0) // WM_COMMAND
					result <- problem
				}()
				var got string
				if conflict {
					got = confirmConflict(0, conflictLabels{Title: title, Body: "body", Overwrite: first, Reload: second, Cancel: labels[2]})
				} else {
					got = confirmClose(0, closeLabels{Title: title, Body: "body", Save: first, DontSave: second, Cancel: labels[2]})
				}
				if err := <-result; err != nil {
					t.Fatal(err)
				}
				if got != want {
					t.Fatalf("%s: %s != %s", title, got, want)
				}
			}
		}
	}
}
