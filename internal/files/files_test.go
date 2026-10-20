package files

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRawBytes(t *testing.T) {
	for _, extension := range []string{".mmd", ".MERMAID", ".txt"} {
		for _, source := range []string{"", "\ufeffflowchart TD\r\n\t甲 --> 乙  \n%% 注释\r"} {
			path := filepath.Join(t.TempDir(), "字节"+extension)
			if err := os.WriteFile(path, []byte(source), 0600); err != nil {
				t.Fatal(err)
			}
			doc, err := Read(path)
			if err != nil {
				t.Fatal(err)
			}
			if doc.Code != source || !filepath.IsAbs(doc.Path) {
				t.Fatalf("open changed bytes: %#v", doc)
			}
			if _, err := Save(doc, path); err != nil {
				t.Fatal(err)
			}
			actual, _ := os.ReadFile(path)
			if string(actual) != source {
				t.Fatal("save changed bytes")
			}
		}
	}
}

func TestMarkdownOnlyFirstBlockAndExternalText(t *testing.T) {
	source := "\ufeff# 标题  \r\n\t说明\r\n```mermaid  \r\nflowchart TD\r\n\t甲 --> 乙  %% 注释\r\n```  \r\n\r\n```mermaid\nA --> B\n```\n尾部\t "
	path := filepath.Join(t.TempDir(), "流程.MD")
	os.WriteFile(path, []byte(source), 0600)
	doc, err := Read(path)
	if err != nil {
		t.Fatal(err)
	}
	serialized, err := Serialize(doc)
	if err != nil || serialized != source {
		t.Fatal("Markdown roundtrip changed bytes", err)
	}
	doc.Code = strings.Replace(doc.Code, "乙", "丙", 1)
	external := strings.Replace(source, "标题", "外部修改", 1)
	os.WriteFile(path, []byte(external), 0600)
	saved, err := Save(doc, path)
	if err != nil {
		t.Fatal(err)
	}
	actual, _ := os.ReadFile(path)
	if string(actual) != strings.Replace(external, "乙", "丙", 1) {
		t.Fatalf("outside bytes changed: %q", actual)
	}
	if saved.Source == nil || *saved.Source != string(actual) {
		t.Fatal("full saved baseline missing")
	}
}

func TestMarkdownFencesAndSaveAs(t *testing.T) {
	source := "````text\n```mermaid\n假块\n```\n````\n~~~mermaid\r\nflowchart LR\r\n~~~~\n"
	start, end, ok := block(source)
	if !ok || source[start:end] != "flowchart LR" {
		t.Fatal("nested fence not skipped")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "新建.md")
	if _, err := Save(Document{Name: "未命名.mmd", Code: "flowchart LR"}, path); err != nil {
		t.Fatal(err)
	}
	actual, _ := os.ReadFile(path)
	if string(actual) != "```mermaid\nflowchart LR\n```\n" {
		t.Fatalf("save as: %q", actual)
	}
	empty := "# a\r\n```mermaid\r\n```\r\n"
	text, err := Serialize(Document{Name: "a.md", Code: "flowchart TD", Source: &empty})
	if err != nil || text != "# a\r\n```mermaid\r\nflowchart TD\r\n```\r\n" {
		t.Fatal("empty fence insert", text, err)
	}
}

func TestFailuresNeverTruncate(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "a.md")
	for _, source := range []string{"# 无 Mermaid 块\r\n", "```mermaid\n无结束标记", string([]byte{0xff, 0xfe, 0})} {
		os.WriteFile(path, []byte(source), 0600)
		if _, err := Read(path); err == nil {
			t.Fatal("invalid open succeeded")
		}
		if _, err := Save(Document{Code: "new"}, path); err == nil {
			t.Fatal("invalid save succeeded")
		}
		actual, _ := os.ReadFile(path)
		if string(actual) != source {
			t.Fatal("failed save truncated original")
		}
	}
	path = filepath.Join(dir, "a.mmd")
	os.WriteFile(path, []byte("original\r\n"), 0400)
	defer os.Chmod(path, 0600)
	if _, err := Save(Document{Code: "new"}, path); err == nil {
		t.Fatal("read-only file overwritten")
	}
	actual, _ := os.ReadFile(path)
	if string(actual) != "original\r\n" {
		t.Fatal("read-only data changed")
	}
	if _, err := Read(filepath.Join(dir, "missing.mmd")); err == nil {
		t.Fatal("missing file opened")
	}
	if _, err := Save(Document{Code: "new"}, filepath.Join(dir, "invalid.exe")); err == nil {
		t.Fatal("unsupported extension saved")
	}
	leftovers, _ := filepath.Glob(filepath.Join(dir, ".mermaid-save-*"))
	if len(leftovers) != 0 {
		t.Fatal("temporary files leaked")
	}
}
