package files

import "sync"

// Watcher compares actual bytes, independently of WebView timers and focus.
// A change stays pending until the frontend acknowledges its hash with Set.
// This also retries notifications skipped during a save or a modal dialog.
type Watcher struct {
	mu         sync.Mutex
	path, hash string
	generation uint64
}

func (w *Watcher) Set(path, hash string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.path, w.hash = path, hash
	w.generation++
}

func (w *Watcher) Changed() (bool, error) {
	w.mu.Lock()
	path, expected, generation := w.path, w.hash, w.generation
	w.mu.Unlock()
	if path == "" {
		return false, nil
	}
	hash, err := Hash(path)
	w.mu.Lock()
	defer w.mu.Unlock()
	if generation != w.generation {
		return false, nil // A different file/baseline was selected during the read.
	}
	return hash != expected, err
}
