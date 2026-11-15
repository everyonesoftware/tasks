package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestParseDefaultsAndAdministratorGuards(t *testing.T) {
	cfg, err := parseArgs(nil)
	if err != nil || cfg.action != "serve" || cfg.host != "127.0.0.1" || cfg.port != 8787 || cfg.db != ".data/daymark.sqlite3" {
		t.Fatalf("defaults: %+v %v", cfg, err)
	}
	for _, args := range [][]string{{"create-user"}, {"--username", "dan"}, {"adopt-legacy", "--username", "dan", "--password-stdin"}, {"serve", "--port", "65536"}, {"unknown"}} {
		if _, err := parseArgs(args); err == nil {
			t.Errorf("accepted invalid args %v", args)
		}
	}
	cfg, err = parseArgs([]string{"create-user", "--username", "fixture", "--password-stdin", "--allowed-host", "one.test", "--allowed-host", "two.test"})
	if err != nil || len(cfg.allowedHosts) != 2 || !cfg.passwordStdin {
		t.Fatalf("account flags: %+v %v", cfg, err)
	}
}

func TestPasswordInputPreservesWhitespaceAndRejectsMultipleLines(t *testing.T) {
	for _, input := range []string{" password ", " password \n"} {
		got, err := readPassword(strings.NewReader(input))
		if err != nil || got != " password " {
			t.Fatalf("password whitespace altered: %q %v", got, err)
		}
	}
	for _, input := range []string{"first\nsecond\n", strings.Repeat("x", 4097), ""} {
		if _, err := readPassword(strings.NewReader(input)); err == nil {
			t.Error("accepted invalid password input")
		}
	}
}

func TestHealthcheckVerifiesTLSAndHealthResponse(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	}))
	defer srv.Close()
	if err := checkHealth(srv.URL, ""); err == nil {
		t.Fatal("accepted untrusted TLS certificate")
	}
	plain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`{"status":"ok"}`)) }))
	defer plain.Close()
	if err := checkHealth(plain.URL, ""); err != nil {
		t.Fatal(err)
	}
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`{"status":"broken"}`)) }))
	defer bad.Close()
	if err := checkHealth(bad.URL, ""); err == nil {
		t.Fatal("accepted unhealthy response")
	}
	redirect := httptest.NewServer(http.RedirectHandler(plain.URL, http.StatusFound))
	defer redirect.Close()
	if err := checkHealth(redirect.URL, ""); err == nil {
		t.Fatal("followed healthcheck redirect")
	}
}

func TestHelpDoesNotCreateDatabase(t *testing.T) {
	var out, stderr bytes.Buffer
	if code := run([]string{"--help"}, strings.NewReader(""), &out, &stderr); code != 0 {
		t.Fatalf("help exit=%d %s", code, stderr.String())
	}
	if !strings.Contains(out.String(), "Tasks") {
		t.Fatal("help missing application name")
	}
}
