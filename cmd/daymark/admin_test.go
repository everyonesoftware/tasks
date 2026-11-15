package main

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"
)

func TestAccountAdministrationDoesNotPrintSecrets(t *testing.T) {
	db := filepath.Join(t.TempDir(), "cli.sqlite3")
	for _, action := range []string{"create-user", "reset-password", "adopt-legacy"} {
		args := []string{action, "--db", db, "--username", "Fixture"}
		if action != "adopt-legacy" {
			args = append(args, "--password-stdin")
		}
		var out, stderr bytes.Buffer
		if code := run(args, strings.NewReader(" fixture-password \n"), &out, &stderr); code != 0 {
			t.Fatalf("%s failed: %s", action, stderr.String())
		}
		if strings.Contains(out.String()+stderr.String(), "fixture-password") {
			t.Fatal("password leaked")
		}
	}
	var out, stderr bytes.Buffer
	if code := run([]string{"create-user", "--db", db, "--username", "Fixture", "--password-stdin"}, strings.NewReader("fixture-password\n"), &out, &stderr); code == 0 {
		t.Fatal("duplicate user accepted")
	}
}
