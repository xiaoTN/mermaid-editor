package applog

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRotate(t *testing.T) {
	old := MaxSize
	MaxSize = 400
	defer func() { MaxSize = old; Close() }()
	p := filepath.Join(t.TempDir(), "sub", "gitdash.log")
	if err := Open(p); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 20; i++ {
		Printf("line %d 中文 %s", i, strings.Repeat("x", 20))
	}
	st, err := os.Stat(p)
	if err != nil || st.Size() > 400 {
		t.Fatalf("log not capped: %v %v", st, err)
	}
	b, _ := os.ReadFile(p + ".1")
	if !strings.Contains(string(b), "line") {
		t.Fatal("rotated file missing")
	}
	cur, _ := os.ReadFile(p)
	if !strings.Contains(string(cur), "line 19 中文") {
		t.Fatalf("last line missing: %q", cur)
	}
}
