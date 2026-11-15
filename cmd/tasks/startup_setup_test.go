package main

import (
	"bufio"
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/everyonesoftware/tasks/services/server"
)

func startupSetupLog(t *testing.T, db string) string {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^TestServerSubprocess$", "--", "serve", "--port", "0", "--db", db, "--web-root", "../../apps/web")
	cmd.Env = append(os.Environ(), "DAYMARK_TEST_PROCESS=1")
	pipe, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = cmd.Stdout
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if cmd.ProcessState == nil {
			cmd.Process.Kill()
			cmd.Wait()
		}
	}()
	ready := make(chan string, 1)
	go func() {
		var lines []string
		scanner := bufio.NewScanner(pipe)
		for scanner.Scan() {
			line := scanner.Text()
			lines = append(lines, line)
			if strings.HasPrefix(line, "Tasks listening on ") {
				ready <- strings.Join(lines, "\n")
				return
			}
		}
		ready <- ""
	}()
	var logs string
	select {
	case logs = <-ready:
		if logs == "" {
			t.Fatal("server exited before startup")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("server startup timed out")
	}
	cmd.Process.Signal(os.Interrupt)
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("shutdown: %v", err)
		}
	case <-time.After(8 * time.Second):
		t.Fatal("shutdown timed out")
	}
	return logs
}

func TestStartupLogsSetupKeyUntilConfigured(t *testing.T) {
	db := filepath.Join(t.TempDir(), "startup.sqlite3")
	readKey := func(logs string) string {
		t.Helper()
		for _, line := range strings.Split(logs, "\n") {
			if key, ok := strings.CutPrefix(line, "Setup key: "); ok {
				raw, err := base64.RawURLEncoding.Strict().DecodeString(key)
				if err != nil || len(raw) != 32 {
					t.Fatal("startup key must be random 32-byte base64url")
				}
				if !strings.Contains(logs, "Setup key expires at ") || !strings.Contains(logs, "Keep server logs private") {
					t.Fatal("missing expiry or log privacy warning")
				}
				return key
			}
		}
		t.Fatal("unconfigured server did not log a setup key")
		return ""
	}
	first := readKey(startupSetupLog(t, db))
	next := readKey(startupSetupLog(t, db))
	if first == next {
		t.Fatal("restart did not rotate the setup key")
	}
	store, err := server.Open(db)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if _, err := store.CompleteSetup(first, "Owner", "fixture-password"); err == nil {
		t.Fatal("replaced startup key still works")
	}
	if _, err := store.CompleteSetup(next, "Owner", "fixture-password"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(startupSetupLog(t, db), "Setup key") {
		t.Fatal("configured server logged setup credentials")
	}
}
