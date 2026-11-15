package deployment

import (
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestContainerEntrypointDefaultsAndOverrides(t *testing.T) {
	entrypoint := rootFile(t, "docker-entrypoint.sh")
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "entrypoint.sh"), []byte(entrypoint), 0600); err != nil {
		t.Fatal(err)
	}
	// Capture the real shell's argument boundaries without starting a server.
	if err := os.WriteFile(filepath.Join(dir, "tasks"), []byte("#!/bin/sh\nprintf '%s\\n' \"$@\"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, hostname string
		args, want     []string
		fail           bool
	}{
		{name: "default server", hostname: "tasks.example.test", want: []string{"serve", "--host", "0.0.0.0", "--port", "8787", "--db", "/data/daymark.sqlite3", "--public-origin", "https://tasks.example.test", "--allow-insecure-http"}},
		{name: "hostname required", fail: true},
		{name: "admin override without hostname", args: []string{"create-user", "--db", "/data/daymark.sqlite3", "--username", "fixture"}, want: []string{"create-user", "--db", "/data/daymark.sqlite3", "--username", "fixture"}},
		{name: "healthcheck override without hostname", args: []string{"healthcheck", "--url", "http://127.0.0.1:8787/health"}, want: []string{"healthcheck", "--url", "http://127.0.0.1:8787/health"}},
		{name: "arguments stay literal", args: []string{"--web-root", "assets with spaces; $(exit 1)"}, want: []string{"--web-root", "assets with spaces; $(exit 1)"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cmd := exec.Command("sh", append([]string{filepath.Join(dir, "entrypoint.sh")}, tc.args...)...)
			cmd.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"), "DAYMARK_HOST=legacy.invalid", "TASKS_HOST="+tc.hostname)
			out, err := cmd.CombinedOutput()
			if tc.fail {
				if err == nil || !strings.Contains(string(out), "TASKS_HOST") {
					t.Fatalf("missing hostname must fail clearly: err=%v output=%s", err, out)
				}
				return
			}
			if err != nil {
				t.Fatalf("entrypoint: %v: %s", err, out)
			}
			got := strings.Split(strings.TrimSuffix(string(out), "\n"), "\n")
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("arguments = %q, want %q", got, tc.want)
			}
		})
	}
}
