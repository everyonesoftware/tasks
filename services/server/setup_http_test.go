package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func setupHTTPFixture(t *testing.T, cfg Config) (*Store, http.Handler) {
	t.Helper()
	s := openFixture(t)
	cfg.Host = "127.0.0.1"
	h, err := NewHandler(s, cfg)
	if err != nil {
		t.Fatal(err)
	}
	return s, h
}

func TestHTTPSetupRejectsDuplicateFieldsWithoutConsumingKey(t *testing.T) {
	s, h := setupHTTPFixture(t, Config{})
	key, _, err := s.GenerateSetupKey()
	if err != nil {
		t.Fatal(err)
	}
	body := `{"setupKey":"` + key + `","username":"Other","username":"First","password":"fixture-password"}`
	w := httpRequest(t, h, "POST", "/api/auth/setup", body, "")
	if w.Code != 400 {
		t.Fatalf("duplicate fields %d %s", w.Code, w.Body)
	}
	if _, err = s.CompleteSetup(key, "First", "fixture-password"); err != nil {
		t.Fatal("invalid input consumed key", err)
	}
}

func TestHTTPSetupMalformedFieldsAndUnicode(t *testing.T) {
	for _, body := range []string{
		`null`, `[]`, `{}`, `{"setupKey":"KEY","username":"First","password":"fixture-password","extra":true}`,
		`{"setupKey":null,"username":"First","password":"fixture-password"}`,
		`{"setupKey":"KEY","username":12,"password":"fixture-password"}`,
		`{"setupKey":"KEY","username":"First","password":[]}`,
		`{"setupKey":"KEY","username":"é","password":"fixture-password"}`,
		`{"setupKey":"KEY","username":"First","password":"short"}`,
		`{"setupKey":"KEY","username":"First","password":"fixture-password\ud800"}`,
		`{"setupKey":"KEY","username":"First","password":"fixture-password"} {}`,
		`{"setupKey":"KEY","username":"First","password":"fixture-password` + "\xff" + `"}`,
	} {
		t.Run(body, func(t *testing.T) {
			s, h := setupHTTPFixture(t, Config{})
			key, _, err := s.GenerateSetupKey()
			if err != nil {
				t.Fatal(err)
			}
			body = strings.ReplaceAll(body, "KEY", key)
			w := httpRequest(t, h, "POST", "/api/auth/setup", body, "")
			if w.Code != 400 || w.Header().Get("Set-Cookie") != "" || strings.Contains(w.Body.String(), key) {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
			setupCounts(t, s, 0, 0, 1)
			if _, err = s.CompleteSetup(key, "First", "fixture-password"); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestHTTPSetupSeparateRateLimitAndRecovery(t *testing.T) {
	s, h := setupHTTPFixture(t, Config{})
	key, _, err := s.GenerateSetupKey()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	h.(*httpHandler).setupLimiter.clock = func() time.Time { return now }
	for i := 0; i < 6; i++ {
		w := httpRequest(t, h, "POST", "/api/auth/setup", `{`, "")
		want := 400
		if i == 5 {
			want = 429
			retry, err := strconv.Atoi(w.Header().Get("Retry-After"))
			if err != nil || retry < 1 {
				t.Fatal("missing Retry-After")
			}
		}
		if w.Code != want {
			t.Fatalf("attempt %d: %d %s", i, w.Code, w.Body)
		}
	}
	// Even an exhausted setup budget must not exhaust login's budget.
	w := httpRequest(t, h, "POST", "/api/auth/login", `{"username":"Missing","password":"fixture-password"}`, "")
	if w.Code != 401 {
		t.Fatalf("login shared setup budget: %d", w.Code)
	}
	now = now.Add(time.Minute)
	body := `{"setupKey":"` + key + `","username":"First","password":"fixture-password"}`
	w = httpRequest(t, h, "POST", "/api/auth/setup", body, "")
	if w.Code != 201 {
		t.Fatalf("window did not recover: %d %s", w.Code, w.Body)
	}
}

func TestHTTPSetupInvalidKeysAndCompletedCLI(t *testing.T) {
	for _, kind := range []string{"missing", "wrong", "expired", "cli"} {
		t.Run(kind, func(t *testing.T) {
			s, h := setupHTTPFixture(t, Config{})
			key := "invalid"
			if kind != "missing" {
				var err error
				key, _, err = s.GenerateSetupKey()
				if err != nil {
					t.Fatal(err)
				}
			}
			if kind == "wrong" {
				key = strings.Repeat("a", 43)
			}
			if kind == "expired" {
				if _, err := s.db.Exec("UPDATE setup_state SET expiresAt='2000-01-01T00:00:00Z'"); err != nil {
					t.Fatal(err)
				}
			}
			if kind == "cli" {
				if _, err := s.CreateUser("CLI", "fixture-password"); err != nil {
					t.Fatal(err)
				}
			}
			w := httpRequest(t, h, "POST", "/api/auth/setup", `{"setupKey":"`+key+`","username":"First","password":"fixture-password"}`, "")
			want := 401
			if kind == "cli" {
				want = 409
			}
			if w.Code != want || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Set-Cookie") != "" {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
		})
	}
}

func TestHTTPSetupRetainsTransportHostOriginAndBodySecurity(t *testing.T) {
	for _, kind := range []string{"host", "origin", "referer", "fetch-site", "content-type", "oversize", "chunked", "https"} {
		t.Run(kind, func(t *testing.T) {
			s, h := setupHTTPFixture(t, Config{})
			key, _, err := s.GenerateSetupKey()
			if err != nil {
				t.Fatal(err)
			}
			body := `{"setupKey":"` + key + `","username":"First","password":"fixture-password"}`
			r := httptest.NewRequest("POST", "http://localhost/api/auth/setup", strings.NewReader(body))
			r.RemoteAddr = "127.0.0.1:123"
			r.Header.Set("Content-Type", "application/json")
			want := 400
			switch kind {
			case "host":
				r.Host = "evil.example"
			case "origin":
				r.Header.Set("Origin", "https://evil.example")
			case "referer":
				r.Header.Set("Referer", "https://evil.example/")
			case "fetch-site":
				r.Header.Set("Sec-Fetch-Site", "cross-site")
			case "content-type":
				r.Header.Set("Content-Type", "text/plain")
			case "oversize":
				r.ContentLength = 65537
			case "chunked":
				r.TransferEncoding = []string{"chunked"}
			case "https":
				r.RemoteAddr = "192.0.2.1:123"
				want = 403
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != want {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
			setupCounts(t, s, 0, 0, 1)
		})
	}
}

func TestHTTPSetupStatusAndAuthenticatedCookie(t *testing.T) {
	s, h := setupHTTPFixture(t, Config{PublicOrigin: "https://localhost"})
	w := httpRequest(t, h, "GET", "/api/auth/setup", "", "")
	if w.Code != 200 || w.Body.String() != `{"setupRequired":true}` || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status %d %s %v", w.Code, w.Body, w.Header())
	}
	w = httpRequest(t, h, "HEAD", "/api/auth/setup", "", "")
	if w.Code != 200 || w.Body.Len() != 0 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(w)
	}
	key, _, err := s.GenerateSetupKey()
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]string{"setupKey": key, "username": "First", "password": "fixture-password"})
	w = httpRequest(t, h, "POST", "/api/auth/setup", string(body), "")
	if w.Code != 201 {
		t.Fatalf("setup %d %s", w.Code, w.Body)
	}
	var session map[string]any
	if err = json.Unmarshal(w.Body.Bytes(), &session); err != nil || len(session) != 3 || session["username"] != "First" {
		t.Fatal(session, err)
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "daymark_session" || cookies[0].Value != session["token"] || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteStrictMode || cookies[0].Path != "/" || cookies[0].MaxAge != 2592000 {
		t.Fatal("unsafe cookie", cookies)
	}
	r := httptest.NewRequest("GET", "http://localhost/api/auth/session", nil)
	r.RemoteAddr = "127.0.0.1:123"
	r.AddCookie(cookies[0])
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"username":"First"`) {
		t.Fatalf("cookie auth %d %s", w.Code, w.Body)
	}
	w = httpRequest(t, h, "GET", "/api/auth/setup", "", "")
	if w.Code != 200 || w.Body.String() != `{"setupRequired":false}` {
		t.Fatalf("status after setup %d %s", w.Code, w.Body)
	}
	w = httpRequest(t, h, "POST", "/api/auth/setup", string(body), "")
	if w.Code != 409 {
		t.Fatalf("reuse %d %s", w.Code, w.Body)
	}
}
