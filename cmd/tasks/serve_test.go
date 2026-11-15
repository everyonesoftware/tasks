package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestServerSubprocess(t *testing.T) {
	if os.Getenv("DAYMARK_TEST_PROCESS") != "1" {
		return
	}
	for i, arg := range os.Args {
		if arg == "--" {
			os.Exit(run(os.Args[i+1:], os.Stdin, os.Stdout, os.Stderr))
		}
	}
	os.Exit(2)
}

func TestCLIStartsServesAndStopsCleanly(t *testing.T) {
	db := filepath.Join(t.TempDir(), "serve.sqlite3")
	cmd := exec.Command(os.Args[0], "-test.run=^TestServerSubprocess$", "--", "serve", "--port", "0", "--db", db, "--web-root", "../../apps/web")
	cmd.Env = append(os.Environ(), "DAYMARK_TEST_PROCESS=1")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if cmd.ProcessState == nil {
			cmd.Process.Kill()
			cmd.Wait()
		}
	}()
	lines := make(chan string, 1)
	go func() {
		s := bufio.NewScanner(stdout)
		if s.Scan() {
			lines <- s.Text()
		} else {
			lines <- ""
		}
	}()
	var line string
	select {
	case line = <-lines:
	case <-time.After(10 * time.Second):
		t.Fatal("server did not announce startup")
	}
	origin := regexp.MustCompile(`http://127\.0\.0\.1:[0-9]+`).FindString(line)
	if origin == "" {
		t.Fatalf("invalid startup: %q %s", line, stderr.String())
	}
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(origin + "/health")
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	json.NewDecoder(resp.Body).Decode(&body)
	resp.Body.Close()
	if resp.StatusCode != 200 || body["status"] != "ok" {
		t.Fatalf("unhealthy: %v", body)
	}
	resp, err = client.Get(origin + "/api/state")
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("unauthenticated API status=%d", resp.StatusCode)
	}
	cmd.Process.Signal(os.Interrupt)
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("unclean shutdown: %v %s", err, stderr.String())
		}
	case <-time.After(8 * time.Second):
		t.Fatal("shutdown timed out")
	}
	if strings.Contains(stderr.String(), "panic") {
		t.Fatal(stderr.String())
	}
}
