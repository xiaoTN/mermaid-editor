package files

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWatchContentAndAcknowledgement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "diagram.mmd")
	before := []byte("flowchart LR\n A --> B\n")
	if err := os.WriteFile(path, before, 0600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := Hash(path)
	if err != nil {
		t.Fatal(err)
	}
	var w Watcher
	w.Set(path, hash)
	check := func(want bool) {
		t.Helper()
		got, err := w.Changed()
		if err != nil || got != want {
			t.Fatalf("Changed = %v, %v; want %v", got, err, want)
		}
	}
	check(false)
	if err := os.WriteFile(path, []byte("flowchart LR\n A --> C\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	unchanged, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.Size() != info.Size() || !unchanged.ModTime().Equal(info.ModTime()) {
		t.Fatal("size/mtime were not restored")
	}
	check(true) // Same size and restored mtime.
	check(true) // A skipped/lost notification must be retried.
	hash, err = Hash(path)
	if err != nil {
		t.Fatal(err)
	}
	w.Set(path, hash)
	check(false)
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	check(true)
	if err := os.WriteFile(path, before, 0600); err != nil {
		t.Fatal(err)
	}
	check(true)
	w.Set("", "")
	check(false)
}

func TestWatchRetriesReadErrorsAndSwitchesFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "temporarily-unreadable.mmd")
	if err := os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	var w Watcher
	w.Set(path, "old")
	if _, err := w.Changed(); err == nil {
		t.Fatal("directory read should fail")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("flowchart TD\n A --> B"), 0600); err != nil {
		t.Fatal(err)
	}
	if changed, err := w.Changed(); !changed || err != nil {
		t.Fatalf("retry: %v, %v", changed, err)
	}
	other := filepath.Join(t.TempDir(), "other.mmd")
	if err := os.WriteFile(other, []byte("flowchart TD\n C --> D"), 0600); err != nil {
		t.Fatal(err)
	}
	hash, err := Hash(other)
	if err != nil {
		t.Fatal(err)
	}
	w.Set(other, hash)
	if changed, err := w.Changed(); changed || err != nil {
		t.Fatalf("switch: %v, %v", changed, err)
	}
}
