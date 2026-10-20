// Package applog is gitdash's tiny diagnostic log: one file, capped by size
// (the previous file is kept as .1), safe for concurrent use. Logging never
// fails loudly; if the file can't be written the line is dropped.
package applog

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// MaxSize is the size at which the log is rotated.
var MaxSize int64 = 1 << 20

var (
	mu   sync.Mutex
	path string
	f    *os.File
	size int64
)

// Open starts logging to file (creating its folder). Calling it again switches files.
func Open(file string) error {
	mu.Lock()
	defer mu.Unlock()
	closeLocked()
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	path = file
	return openLocked()
}

func openLocked() error {
	var err error
	f, err = os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		f = nil
		return err
	}
	if st, err := f.Stat(); err == nil {
		size = st.Size()
	}
	return nil
}

func closeLocked() {
	if f != nil {
		f.Close()
		f = nil
	}
}

// Path is the current log file ("" before Open).
func Path() string {
	mu.Lock()
	defer mu.Unlock()
	return path
}

// Printf writes one timestamped line.
func Printf(format string, args ...any) {
	line := time.Now().Format("2006-01-02 15:04:05.000") + fmt.Sprintf(" [%d] ", os.Getpid()) + fmt.Sprintf(format, args...)
	if n := len(line); n == 0 || line[n-1] != '\n' {
		line += "\n"
	}
	mu.Lock()
	defer mu.Unlock()
	if f == nil {
		return
	}
	if size+int64(len(line)) > MaxSize {
		closeLocked()
		os.Remove(path + ".1")
		os.Rename(path, path+".1")
		if openLocked() != nil {
			return
		}
	}
	n, _ := f.WriteString(line)
	size += int64(n)
}

// Close flushes and closes the file.
func Close() {
	mu.Lock()
	defer mu.Unlock()
	closeLocked()
}
