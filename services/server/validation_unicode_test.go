package server

import "testing"

func TestTitleTrimsPythonUnicodeWhitespace(t *testing.T) {
	got, err := taskFields(map[string]any{"title": "\x1c\x1d\x1e\x1f\u0085\u00a0 Task \u2003\u2028\u2029\u3000", "startDate": "2026-11-14"})
	if err != nil || got["title"] != "Task" {
		t.Fatalf("Python str.strip compatibility: %v %v", got, err)
	}
}
