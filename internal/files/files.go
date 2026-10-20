// Package files preserves UTF-8 file bytes across native open/save operations.
package files

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

type Document struct {
	Code     string  `json:"code"`
	Name     string  `json:"name"`
	Path     string  `json:"path,omitempty"`
	Source   *string `json:"source,omitempty"`
	Untitled bool    `json:"untitled,omitempty"`
	DiskHash string  `json:"diskHash,omitempty"`
	Reloaded bool    `json:"reloaded,omitempty"`
}

var ErrChangedOutside = errors.New("file changed outside the editor")

// Hash always reads bytes: size and mtime alone miss same-size external edits.
func Hash(path string) (string, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return "missing", nil
	}
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", sha256.Sum256(data)), nil
}

func Supported(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".mmd", ".mermaid", ".md", ".txt":
		return true
	}
	return false
}

var linePattern = regexp.MustCompile(`[^\r\n]*(?:\r\n|\n|\r|$)`)
var openingPattern = regexp.MustCompile("^ {0,3}(`{3,}|~{3,})(.*)$")

func block(source string) (start, end int, found bool) {
	fence := ""
	mermaid := false
	for _, span := range linePattern.FindAllStringIndex(source, -1) {
		if span[0] == span[1] {
			continue
		}
		line := strings.TrimPrefix(strings.TrimRight(source[span[0]:span[1]], "\r\n"), "\ufeff")
		if fence == "" {
			parts := openingPattern.FindStringSubmatch(line)
			if parts == nil {
				continue
			}
			fence = parts[1]
			mermaid = strings.EqualFold(strings.TrimSpace(parts[2]), "mermaid")
			start = span[1]
		} else {
			closing := regexp.MustCompile("^ {0,3}" + fence[:1] + "{" + strconv.Itoa(len(fence)) + ",}[\t ]*$")
			if !closing.MatchString(line) {
				continue
			}
			if mermaid {
				end = span[0]
				if end > start {
					if strings.HasSuffix(source[start:end], "\r\n") {
						end -= 2
					} else {
						end--
					}
				}
				return start, end, true
			}
			fence = ""
		}
	}
	return 0, 0, false
}

func Read(path string) (Document, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return Document{}, err
	}
	if !Supported(path) {
		return Document{}, errors.New("请选择 .mmd、.mermaid、.md 或 .txt 文件")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Document{}, err
	}
	if !utf8.Valid(data) {
		return Document{}, errors.New("文件不是有效的 UTF-8 编码，请先转换为 UTF-8")
	}
	source := string(data)
	doc := Document{Code: source, Name: filepath.Base(path), Path: path, DiskHash: fmt.Sprintf("%x", sha256.Sum256(data))}
	if strings.EqualFold(filepath.Ext(path), ".md") {
		start, end, ok := block(source)
		if !ok {
			return Document{}, errors.New("文件中没有完整的 Mermaid 代码块")
		}
		doc.Code = source[start:end]
		doc.Source = &source
	}
	return doc, nil
}

func Serialize(doc Document) (string, error) {
	if !strings.EqualFold(filepath.Ext(doc.Name), ".md") {
		return doc.Code, nil
	}
	if doc.Source == nil {
		separator := ""
		if doc.Code != "" && !strings.HasSuffix(doc.Code, "\n") && !strings.HasSuffix(doc.Code, "\r") {
			separator = "\n"
		}
		return "```mermaid\n" + doc.Code + separator + "```\n", nil
	}
	source := *doc.Source
	start, end, ok := block(source)
	if !ok {
		return "", errors.New("文件中没有完整的 Mermaid 代码块")
	}
	separator := ""
	if start == end && !strings.HasPrefix(source[end:], "\r") && !strings.HasPrefix(source[end:], "\n") && doc.Code != "" && !strings.HasSuffix(doc.Code, "\r") && !strings.HasSuffix(doc.Code, "\n") {
		separator = "\n"
		if strings.Contains(source, "\r\n") {
			separator = "\r\n"
		}
	}
	return source[:start] + doc.Code + separator + source[end:], nil
}

func Save(doc Document, path string) (Document, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return Document{}, err
	}
	expected := ""
	if strings.EqualFold(filepath.Clean(doc.Path), path) {
		expected = doc.DiskHash
	}
	check := func() error {
		if expected == "" {
			return nil
		}
		hash, err := Hash(path)
		if err != nil {
			return err
		}
		if hash != expected {
			return ErrChangedOutside
		}
		return nil
	}
	if err := check(); err != nil {
		return Document{}, err
	}
	if !Supported(path) {
		return Document{}, errors.New("请选择 .mmd、.mermaid、.md 或 .txt 文件")
	}
	doc.Path, doc.Name, doc.Untitled = path, filepath.Base(path), false
	doc.Reloaded = false // response-only flag must not survive a later save request
	// Re-read Markdown so external changes outside the first block survive saving.
	if strings.EqualFold(filepath.Ext(path), ".md") {
		if data, readErr := os.ReadFile(path); readErr == nil {
			if !utf8.Valid(data) {
				return Document{}, errors.New("文件不是有效的 UTF-8 编码")
			}
			source := string(data)
			doc.Source = &source
		} else if !os.IsNotExist(readErr) {
			return Document{}, readErr
		}
	} else {
		doc.Source = nil
	}
	source, err := Serialize(doc)
	if err != nil {
		return Document{}, err
	}
	// Stage beside the destination; a failed write must never truncate the original.
	tmp, err := os.CreateTemp(filepath.Dir(path), ".mermaid-save-*")
	if err != nil {
		return Document{}, err
	}
	defer os.Remove(tmp.Name())
	if info, statErr := os.Stat(path); statErr == nil {
		if info.Mode().Perm()&0200 == 0 {
			tmp.Close()
			return Document{}, errors.New("文件为只读，无法保存")
		}
		if err = tmp.Chmod(info.Mode().Perm()); err != nil {
			tmp.Close()
			return Document{}, err
		}
	}
	_, err = tmp.WriteString(source)
	if err == nil {
		err = tmp.Sync()
	}
	closeErr := tmp.Close()
	if err != nil {
		return Document{}, err
	}
	if closeErr != nil {
		return Document{}, closeErr
	}
	if err = check(); err != nil {
		return Document{}, err
	}
	if err = replaceFile(tmp.Name(), path); err != nil {
		return Document{}, err
	}
	if strings.EqualFold(filepath.Ext(path), ".md") {
		doc.Source = &source
	}
	doc.DiskHash = fmt.Sprintf("%x", sha256.Sum256([]byte(source)))
	return doc, nil
}
