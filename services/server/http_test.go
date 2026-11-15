package server

import (
	"bufio"
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestHTTPProxyOriginAndSecureCookie(t *testing.T) {
	_, h := newHTTPFixture(t, Config{PublicOrigin: "https://public.example:8443"})
	for _, origin := range []string{"https://public.example:8443", "http://public.example:8443", "https://evil.example"} {
		r := httptest.NewRequest("POST", "http://public.example:8443/api/auth/login", strings.NewReader(`{"username":"Fixture","password":"fixture-password"}`))
		r.RemoteAddr = "127.0.0.1:123"
		r.Header.Set("Origin", origin)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Forwarded-Proto", "https")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		want := 400
		if origin == "https://public.example:8443" {
			want = 200
		}
		if w.Code != want {
			t.Fatalf("%s: %d %s", origin, w.Code, w.Body)
		}
		if want == 200 && !strings.Contains(w.Header().Get("Set-Cookie"), "; Secure") {
			t.Fatal("proxy session missing Secure cookie")
		}
	}
}

func TestHTTPAmbiguousCredentialsAreDenied(t *testing.T) {
	s, h := newHTTPFixture(t, Config{})
	login, err := s.Login("Fixture", "fixture-password")
	if err != nil {
		t.Fatal(err)
	}
	token := login["token"].(string)
	for _, headers := range []http.Header{
		{"Authorization": []string{"Bearer " + token, "Bearer " + token}},
		{"Authorization": []string{"Basic malformed"}, "Cookie": []string{"daymark_session=" + token}},
		{"Cookie": []string{"daymark_session=" + token + "; daymark_session=" + token}},
		{"Cookie": []string{"daymark_session=" + token, "other=value"}},
	} {
		r := httptest.NewRequest("GET", "http://localhost/api/auth/session", nil)
		r.RemoteAddr = "127.0.0.1:123"
		r.Header = headers
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 401 {
			t.Fatalf("ambiguous credentials: %d", w.Code)
		}
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	w := httpRequest(t, h, "GET", "/api/auth/session", "", token)
	if w.Code != 500 || w.Body.String() != `{"error":"Internal server error"}` {
		t.Fatalf("internal error leaked: %d %s", w.Code, w.Body)
	}
}

func TestHTTPUnknownLengthIsRejectedOnEveryRoute(t *testing.T) {
	_, h := newHTTPFixture(t, Config{})
	r := httptest.NewRequest("GET", "http://localhost/health", nil)
	r.RemoteAddr = "127.0.0.1:123"
	r.ContentLength = -1
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 400 {
		t.Fatalf("unknown body length: %d %s", w.Code, w.Body)
	}
}

func TestHTTPRealListenerFramingAndPartialBodyDeadline(t *testing.T) {
	_, h := newHTTPFixture(t, Config{})
	h.(*httpHandler).readTimeout = 80 * time.Millisecond
	srv := httptest.NewUnstartedServer(h)
	srv.Config.ReadHeaderTimeout = time.Second
	srv.Config.WriteTimeout = 2 * time.Second
	srv.Start()
	defer srv.Close()
	address := srv.Listener.Addr().String()
	for _, tc := range []struct {
		name, raw string
		status    int
		json      bool
	}{
		{"chunked", "POST /api/auth/login HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n2\r\n{}\r\n0\r\n\r\n", 400, true},
		{"oversize GET", "GET /health HTTP/1.1\r\nHost: localhost\r\nContent-Length: 65537\r\nConnection: close\r\n\r\n", 400, true},
		{"duplicate Host", "GET /health HTTP/1.1\r\nHost: localhost\r\nHost: evil.example\r\nConnection: close\r\n\r\n", 400, false},
		{"conflicting lengths", "POST /api/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Length: 2\r\nContent-Length: 3\r\nConnection: close\r\n\r\n{}", 400, false},
		{"partial JSON", "POST /api/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{", 400, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			conn, err := net.DialTimeout("tcp", address, time.Second)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			if err := conn.SetDeadline(time.Now().Add(3 * time.Second)); err != nil {
				t.Fatal(err)
			}
			if _, err := io.WriteString(conn, tc.raw); err != nil {
				t.Fatal(err)
			}
			response, err := http.ReadResponse(bufio.NewReader(conn), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != tc.status {
				t.Fatalf("%d %s", response.StatusCode, body)
			}
			if tc.json {
				var data map[string]any
				if err := json.Unmarshal(body, &data); err != nil {
					t.Fatalf("non JSON: %s", body)
				}
			}
		})
	}
	response, err := http.Get(srv.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal(response.Status)
	}
}

func TestHTTPMalformedLoginConsumesRateBudget(t *testing.T) {
	_, h := newHTTPFixture(t, Config{})
	for i := 0; i < 6; i++ {
		w := httpRequest(t, h, "POST", "/api/auth/login", "{", "")
		want := 400
		if i == 5 {
			want = 429
		}
		if w.Code != want {
			t.Fatalf("malformed attempt %d => %d %s", i, w.Code, w.Body)
		}
	}
	limiter := loginLimiter{}
	now := time.Unix(1000, 0)
	limiter.clock = func() time.Time { return now }
	for i := 0; i < 5; i++ {
		if retry := limiter.begin("peer"); retry != 0 {
			t.Fatal(retry)
		}
	}
	if limiter.begin("peer") == 0 {
		t.Fatal("inflight requests bypass limiter")
	}
	for i := 0; i < 5; i++ {
		limiter.finish("peer", true)
	}
	now = now.Add(time.Minute)
	if limiter.begin("peer") != 0 {
		t.Fatal("expired rate window")
	}
	limiter.finish("peer", false)
	limiter.peers = make(map[string]*loginAttempt)
	for i := 0; i < 4096; i++ {
		limiter.peers[fmt.Sprint(i)] = &loginAttempt{until: now.Add(time.Minute)}
	}
	if limiter.begin("new") != 60 {
		t.Fatal("unbounded limiter memory")
	}
}

func TestHTTPMalformedCredentialShapesStayGeneric(t *testing.T) {
	for _, body := range []string{`[]`, `null`, `{"username":[],"password":[]}`, `{"username":"Fixture","password":"\ud800\ud800\ud800\ud800\ud800\ud800\ud800\ud800"}`} {
		_, h := newHTTPFixture(t, Config{})
		w := httpRequest(t, h, "POST", "/api/auth/login", body, "")
		if w.Code != 401 || w.Body.String() != `{"error":"Invalid username or password"}` {
			t.Errorf("credential shape %s: %d %s", body, w.Code, w.Body)
		}
	}
}

func TestHTTPCompletionUndoAndIsolation(t *testing.T) {
	s, h := newHTTPFixture(t, Config{})
	if _, err := s.CreateUser("Other", "other-password"); err != nil {
		t.Fatal(err)
	}
	a, err := s.Login("Fixture", "fixture-password")
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Login("Other", "other-password")
	if err != nil {
		t.Fatal(err)
	}
	tokens := []string{a["token"].(string), b["token"].(string)}
	for i, token := range tokens {
		w := httpRequest(t, h, "POST", "/api/tasks", fmt.Sprintf(`{"title":"Private%d","startDate":"2026-11-14"}`, i), token)
		if w.Code != 201 {
			t.Fatalf("create %d %s", w.Code, w.Body)
		}
		var task map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &task); err != nil {
			t.Fatal(err)
		}
		id := task["id"].(string)
		body := fmt.Sprintf(`{"taskId":%q,"dueDate":"2026-11-14","date":"2026-11-14"}`, id)
		for _, route := range []string{"complete", "undo"} {
			w = httpRequest(t, h, "POST", "/api/occurrences/"+route, body, token)
			if w.Code != 200 {
				t.Fatalf("%s: %d %s", route, w.Code, w.Body)
			}
			w = httpRequest(t, h, "POST", "/api/occurrences/"+route, body, tokens[1-i])
			if w.Code != 404 {
				t.Fatalf("cross owner %s: %d %s", route, w.Code, w.Body)
			}
		}
		for _, method := range []string{"PUT", "DELETE"} {
			w = httpRequest(t, h, method, "/api/tasks/"+id, `{"title":"Stolen","startDate":"2026-11-14"}`, tokens[1-i])
			if w.Code != 404 {
				t.Fatalf("cross owner %s: %d %s", method, w.Code, w.Body)
			}
		}
		for _, p := range []string{"/api/state?date=2026-11-14", "/api/export"} {
			w = httpRequest(t, h, "GET", p, "", tokens[1-i])
			if w.Code != 200 || strings.Contains(w.Body.String(), id) {
				t.Fatalf("cross owner read %s: %d %s", p, w.Code, w.Body)
			}
		}
	}
}

func TestHTTPScopedCRUDAndExport(t *testing.T) {
	s, h := newHTTPFixture(t, Config{})
	login, err := s.Login("Fixture", "fixture-password")
	if err != nil {
		t.Fatal(err)
	}
	token := login["token"].(string)
	for _, p := range []string{"/api/state?date=2026-11-14", "/api/export"} {
		w := httpRequest(t, h, "GET", p, "", token)
		if w.Code != 200 {
			t.Fatalf("%s: %d %s", p, w.Code, w.Body)
		}
	}
	w := httpRequest(t, h, "POST", "/api/tasks", `{"title":"Task","startDate":"2026-11-14","interval":2,"priority":1}`, token)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body)
	}
	var task map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &task); err != nil {
		t.Fatal(err)
	}
	path := "/api/tasks/" + task["id"].(string)
	w = httpRequest(t, h, "PUT", path, `{"title":"Edited","startDate":"2026-11-14"}`, token)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "Edited") {
		t.Fatalf("update %d %s", w.Code, w.Body)
	}
	for _, q := range []string{"?date=bad", "?date=2026-02-30", "?date=2026-11-14&date=2026-11-15"} {
		w = httpRequest(t, h, "GET", "/api/state"+q, "", token)
		if w.Code != 400 {
			t.Errorf("date %s => %d", q, w.Code)
		}
	}
	for _, method := range []string{"TRACE", "CONNECT", "UNSUPPORTED"} {
		if w = httpRequest(t, h, method, "/api/state", "", token); w.Code != 405 {
			t.Errorf("%s: %d", method, w.Code)
		}
	}
	if w = httpRequest(t, h, "DELETE", path, "", token); w.Code != 204 || w.Body.Len() != 0 {
		t.Fatalf("archive %d %s", w.Code, w.Body)
	}
	w = httpRequest(t, h, "GET", "/api/export", "", token)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"archived":1`) || !strings.Contains(w.Header().Get("Content-Disposition"), "tasks-backup.json") {
		t.Fatalf("export %d %s", w.Code, w.Body)
	}
}

func TestHTTPLoginRateLimitBySocketPeer(t *testing.T) {
	_, h := newHTTPFixture(t, Config{})
	var first string
	for i := 0; i < 6; i++ {
		r := httptest.NewRequest("POST", "http://localhost/api/auth/login", strings.NewReader(`{"username":"missing","password":"wrong-password"}`))
		r.RemoteAddr = "127.0.0.1:123"
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Forwarded-For", fmt.Sprint(i))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		want := 401
		if i == 5 {
			want = 429
		}
		if w.Code != want {
			t.Fatalf("attempt %d: %d %s", i, w.Code, w.Body)
		}
		if i == 0 {
			first = w.Body.String()
		}
		if i < 5 && w.Body.String() != first {
			t.Error("non generic login failure")
		}
		if i == 5 && w.Header().Get("Retry-After") == "" {
			t.Error("missing Retry-After")
		}
	}
}

func newHTTPFixture(t *testing.T, cfg Config) (*Store, http.Handler) {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "http.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	if _, err := s.CreateUser("Fixture", "fixture-password"); err != nil {
		t.Fatal(err)
	}
	if cfg.Host == "" {
		cfg.Host = "127.0.0.1"
	}
	h, err := NewHandler(s, cfg)
	if err != nil {
		t.Fatal(err)
	}
	return s, h
}
func httpRequest(t *testing.T, h http.Handler, method, path, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, "http://localhost"+path, strings.NewReader(body))
	r.Host = "localhost"
	r.RemoteAddr = "127.0.0.1:123"
	r.Header.Set("Content-Type", "application/json")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestHTTPAuthenticationLifecycle(t *testing.T) {
	_, h := newHTTPFixture(t, Config{})
	w := httpRequest(t, h, "GET", "/health", "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"version":"`+Version+`"`) {
		t.Fatalf("health %d %s", w.Code, w.Body)
	}
	for _, path := range []string{"/api/state", "/api/export", "/api/auth/session", "/api/missing"} {
		w := httpRequest(t, h, "GET", path, "", "")
		if w.Code != 401 {
			t.Errorf("anonymous %s: %d %s", path, w.Code, w.Body)
		}
	}
	w = httpRequest(t, h, "POST", "/api/auth/login", `{"username":"fixture","password":"fixture-password"}`, "")
	if w.Code != 200 {
		t.Fatalf("login %d %s", w.Code, w.Body)
	}
	var login map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &login); err != nil {
		t.Fatal(err)
	}
	token := login["token"].(string)
	cookie := w.Result().Cookies()
	if len(cookie) != 1 || !cookie[0].HttpOnly || cookie[0].SameSite != http.SameSiteStrictMode || cookie[0].Secure {
		t.Fatalf("cookie: %#v", cookie)
	}
	for _, bearer := range []bool{true, false} {
		r := httptest.NewRequest("GET", "http://localhost/api/auth/session", nil)
		r.RemoteAddr = "127.0.0.1:123"
		if bearer {
			r.Header.Set("Authorization", "Bearer "+token)
		} else {
			r.AddCookie(cookie[0])
		}
		w = httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 || strings.Contains(w.Body.String(), token) || strings.Contains(w.Body.String(), "userId") {
			t.Fatalf("session: %d %s", w.Code, w.Body)
		}
	}
	w = httpRequest(t, h, "HEAD", "/api/auth/session", "", token)
	if w.Code != 200 || w.Body.Len() != 0 || w.Header().Get("Content-Length") == "0" {
		t.Fatalf("HEAD: %d %s", w.Code, w.Body)
	}
	w = httpRequest(t, h, "POST", "/api/auth/logout", "", token)
	if w.Code != 204 || w.Body.Len() != 0 || !strings.Contains(w.Header().Get("Set-Cookie"), "Max-Age=0") {
		t.Fatalf("logout: %d %s", w.Code, w.Body)
	}
	if w = httpRequest(t, h, "GET", "/api/auth/session", "", token); w.Code != 401 {
		t.Fatalf("revoked token %d", w.Code)
	}
}

func TestHTTPBoundedJSON(t *testing.T) {
	for _, tc := range []struct {
		body, ct string
		length   int64
		chunked  bool
		ok       bool
	}{
		{`{"interval":1}`, "application/json", 14, false, true},
		{`{"interval":1.0}`, "application/json", 16, false, true},
		{`[]`, "application/json", 2, false, false},
		{`null`, "application/json", 4, false, false},
		{`{}`, "text/plain", 2, false, false},
		{`{}`, "application/json", 0, false, false},
		{`{}`, "application/json", 65537, false, false},
		{`{}`, "application/json", 2, true, false},
		{`{}`, "application/json", 5, false, false},
		{`{} {}`, "application/json", 5, false, false},
		{"{\"title\":\"\xff\"}", "application/json", 13, false, false},
		{`{"title":"\ud800"}`, "application/json", 18, false, false},
		{`{"title":"\ud83d\ude00"}`, "application/json", 24, false, true},
	} {
		r := httptest.NewRequest("POST", "http://localhost/api/tasks", strings.NewReader(tc.body))
		r.ContentLength = tc.length
		r.Header.Set("Content-Type", tc.ct)
		if tc.chunked {
			r.TransferEncoding = []string{"chunked"}
		}
		data, err := readRequestJSON(httptest.NewRecorder(), r)
		if (err == nil) != tc.ok {
			t.Errorf("%+v => %v", tc, err)
		}
		if tc.ok && data["interval"] != nil {
			if _, ok := data["interval"].(json.Number); !ok {
				t.Errorf("not UseNumber: %#v", data)
			}
		}
	}
	r := httptest.NewRequest("POST", "http://localhost/api/tasks", bytes.NewReader([]byte("{}")))
	r.Header.Set("Content-Type", "application/json")
	r.Header["Content-Length"] = []string{"2", "2"}
	if _, err := readRequestJSON(httptest.NewRecorder(), r); err == nil {
		t.Error("duplicate content lengths accepted")
	}
}

func TestHTTPStaticDatabaseAliasProtectsRealSidecars(t *testing.T) {
	root := t.TempDir()
	db := filepath.Join(root, "database.sqlite3")
	alias := filepath.Join(t.TempDir(), "alias.sqlite3")
	for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
		if err := os.WriteFile(db+suffix, []byte("private fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(db, alias); err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
		r := httptest.NewRequest("GET", "http://localhost/database.sqlite3"+suffix, nil)
		if err := serveStatic(httptest.NewRecorder(), r, root, []string{alias}); err == nil {
			t.Errorf("exposed database alias sidecar %s", suffix)
		}
	}
}

func TestHTTPStaticConfinement(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	db := filepath.Join(root, "private.sqlite3")
	for _, name := range []string{"index.html", "app.js", ".env", "private.sqlite3", "private.sqlite3-wal", "private.sqlite3-shm", "private.sqlite3-journal"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "secret"), filepath.Join(root, "escape")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "app.js"), filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"/", "/app.js", "/.env", "/../secret", "/%2e%2e/secret", "/escape", "/link", "/private.sqlite3", "/private.sqlite3-wal", "/private.sqlite3-shm", "/private.sqlite3-journal", "/%00", "/foo%5cbar", "/missing"} {
		r := httptest.NewRequest("GET", "http://localhost"+p, nil)
		w := httptest.NewRecorder()
		err := serveStatic(w, r, root, []string{db})
		want := p == "/" || p == "/app.js"
		if (err == nil) != want {
			t.Errorf("%s: err=%v", p, err)
		}
		if want && (w.Header().Get("X-Content-Type-Options") != "nosniff" || !strings.Contains(w.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'")) {
			t.Errorf("missing static security headers: %v", w.Header())
		}
	}
}

func TestHTTPHostOriginAndTransportGuards(t *testing.T) {
	cfg := Config{Host: "127.0.0.1"}
	for _, tc := range []struct {
		host, method, path, origin, referer, fetch, peer string
		tls, ok                                          bool
	}{
		{"127.0.0.1:8787", "GET", "/api/state", "", "", "", "127.0.0.1:123", false, true},
		{"evil.example", "GET", "/health", "", "", "", "127.0.0.1:123", false, false},
		{"localhost.evil.example", "GET", "/health", "", "", "", "127.0.0.1:123", false, false},
		{"100.101.102.103:8787", "GET", "/health", "", "", "", "127.0.0.1:123", false, true},
		{"[fd7a:115c:a1e0::1]:8787", "GET", "/health", "", "", "", "127.0.0.1:123", false, true},
		{"hermesdan.tail1a7c8f.ts.net:8787", "GET", "/api/state", "", "", "", "127.0.0.1:123", false, false},
		{"localhost", "GET", "/api/state", "", "", "", "203.0.113.1:123", false, false},
		{"localhost:8787", "POST", "/api/tasks", "http://localhost:8787", "http://localhost:8787/form", "same-origin", "127.0.0.1:123", false, true},
		{"localhost", "POST", "/api/tasks", "https://evil.example", "", "", "127.0.0.1:123", false, false},
		{"localhost", "POST", "/api/tasks", "http://localhost/", "", "", "127.0.0.1:123", false, false},
		{"localhost", "POST", "/api/tasks", "http://localhost", "", "same-site", "127.0.0.1:123", false, false},
		{"localhost", "POST", "/api/tasks", "http://localhost", "https://evil.example/form", "", "127.0.0.1:123", false, false},
		{"localhost", "POST", "/api/tasks", "https://localhost", "", "", "203.0.113.1:123", true, true},
	} {
		r := httptest.NewRequest(tc.method, "http://"+tc.host+tc.path, nil)
		r.Host = tc.host
		r.RemoteAddr = tc.peer
		if tc.tls {
			r.TLS = &tls.ConnectionState{}
		}
		if tc.origin != "" {
			r.Header.Set("Origin", tc.origin)
		}
		if tc.referer != "" {
			r.Header.Set("Referer", tc.referer)
		}
		if tc.fetch != "" {
			r.Header.Set("Sec-Fetch-Site", tc.fetch)
		}
		r.Header.Set("X-Forwarded-Proto", "https")
		if err := checkRequestSecurity(cfg, r); (err == nil) != tc.ok {
			t.Errorf("%+v: error=%v", tc, err)
		}
	}
}

func TestHTTPConfigTransportPolicy(t *testing.T) {
	for _, cfg := range []Config{
		{Host: "0.0.0.0"}, {Host: "127.0.0.1", TLSCert: "missing"},
		{Host: "127.0.0.1", PublicOrigin: "http://public.example"},
		{Host: "127.0.0.1", PublicOrigin: "https://user@public.example"},
		{Host: "127.0.0.1", PublicOrigin: "https://public.example/"},
		{Host: "127.0.0.1", PublicOrigin: "https://public.example?"},
		{Host: "127.0.0.1", PublicOrigin: "https://public.example#"},
		{Host: "127.0.0.1", PublicOrigin: "https://public.example:bad"},
		{Host: "127.0.0.1", PublicOrigin: "https://public.example:443:444"},
		{Host: "127.0.0.1", PublicOrigin: "https://::1"},
		{Host: "127.0.0.1", PublicOrigin: "https://[not-ip]"},
		{Host: "127.0.0.1", PublicOrigin: "https://[127.0.0.1]"},
		{Host: "127.0.0.1", AllowedHosts: []string{"evil.example/path"}},
		{Host: "127.0.0.1", TLSCert: "missing", TLSKey: "missing"},
	} {
		if err := ValidateConfig(cfg); err == nil {
			t.Errorf("accepted invalid config: %+v", cfg)
		}
	}
	for _, cfg := range []Config{{Host: "127.0.0.1"}, {Host: "localhost"}, {Host: "::1"}, {Host: "0.0.0.0", AllowInsecureHTTP: true}, {Host: "127.0.0.1", PublicOrigin: "https://public.example:8443"}} {
		if err := ValidateConfig(cfg); err != nil {
			t.Errorf("rejected valid config: %+v: %v", cfg, err)
		}
	}
}
