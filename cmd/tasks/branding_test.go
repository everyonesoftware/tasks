package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestTasksBrandingPreservesExistingDatabaseDefault(t *testing.T) {
	var out, stderr bytes.Buffer
	if code := run([]string{"--help"}, strings.NewReader(""), &out, &stderr); code != 0 {
		t.Fatalf("help: %d %s", code, stderr.String())
	}
	if !strings.Contains(out.String(), "Tasks private Go server") || !strings.Contains(out.String(), "Usage: tasks ") || strings.Contains(out.String(), "Daymark") {
		t.Fatalf("old or missing CLI brand: %s", &out)
	}
	cfg, err := parseArgs(nil)
	if err != nil || cfg.db != ".data/daymark.sqlite3" {
		t.Fatalf("rebrand must not move existing data: %+v %v", cfg, err)
	}
}
