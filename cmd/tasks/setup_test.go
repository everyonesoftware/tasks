package main

import (
	"bytes"
	"encoding/base64"
	"path/filepath"
	"strings"
	"testing"

	"github.com/everyonesoftware/tasks/services/server"
)

func TestSetupKeyCLIExplicitOutputAndRotation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "setup.sqlite3")
	var out, stderr bytes.Buffer
	args := []string{"setup-key", "--db", path}
	if code := run(args, strings.NewReader(""), &out, &stderr); code != 0 {
		t.Fatalf("code=%d stderr=%s", code, &stderr)
	}
	key := strings.TrimSuffix(out.String(), "\n")
	raw, err := base64.RawURLEncoding.Strict().DecodeString(key)
	if err != nil || len(raw) < 32 || strings.Contains(stderr.String(), key) {
		t.Fatal("key output not stdout-only base64url")
	}
	out.Reset()
	stderr.Reset()
	if code := run(args, strings.NewReader(""), &out, &stderr); code != 0 {
		t.Fatalf("rotate: %d %s", code, &stderr)
	}
	next := strings.TrimSuffix(out.String(), "\n")
	if next == key {
		t.Fatal("key not rotated")
	}
	s, err := server.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err = s.CompleteSetup(key, "First", "fixture-password"); err == nil {
		t.Fatal("old key worked")
	}
	if _, err = s.CompleteSetup(next, "First", "fixture-password"); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	stderr.Reset()
	if code := run(args, strings.NewReader(""), &out, &stderr); code == 0 || out.Len() != 0 {
		t.Fatalf("completed setup printed key: %d %s", code, &out)
	}
}
