package server

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

// Config is the HTTP listener and security policy shared by the CLI and handler.
type Config struct {
	Host              string
	Port              int
	DB                string
	WebRoot           string
	AllowedHosts      []string
	PublicOrigin      string
	AllowInsecureHTTP bool
	TLSCert           string
	TLSKey            string
}

type loginAttempt struct {
	until            time.Time
	failed, inflight int
}
type loginLimiter struct {
	mu    sync.Mutex
	peers map[string]*loginAttempt
	clock func() time.Time
}

func (l *loginLimiter) begin(peer string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if l.clock != nil {
		now = l.clock()
	}
	if l.peers == nil {
		l.peers = make(map[string]*loginAttempt)
	}
	for key, entry := range l.peers {
		if !entry.until.After(now) && entry.inflight == 0 {
			delete(l.peers, key)
		}
	}
	entry := l.peers[peer]
	if entry == nil {
		if len(l.peers) >= 4096 {
			return 60
		}
		entry = &loginAttempt{until: now.Add(time.Minute)}
		l.peers[peer] = entry
	}
	if entry.failed+entry.inflight >= 5 {
		return max(1, int(math.Ceil(entry.until.Sub(now).Seconds())))
	}
	entry.inflight++
	return 0
}
func (l *loginLimiter) finish(peer string, failed bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	entry := l.peers[peer]
	if entry == nil {
		return
	}
	entry.inflight--
	if failed {
		entry.failed++
	}
}

type httpHandler struct {
	store        *Store
	cfg          Config
	webRoot      string
	readTimeout  time.Duration
	limiter      loginLimiter
	setupLimiter loginLimiter
}

// NewHandler builds the same-origin API and confined static frontend. The store
// remains owned by the caller; constructing a handler never seeds user data.
func NewHandler(store *Store, cfg Config) (http.Handler, error) {
	if err := ValidateConfig(cfg); err != nil {
		return nil, err
	}
	if store == nil {
		return nil, fmt.Errorf("store is required")
	}
	root := cfg.WebRoot
	if root == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return nil, err
		}
		for {
			candidate := filepath.Join(cwd, "apps", "web")
			if info, err := os.Stat(candidate); err == nil && info.IsDir() {
				root = candidate
				break
			}
			parent := filepath.Dir(cwd)
			if parent == cwd {
				return nil, fmt.Errorf("apps/web directory not found; configure web root")
			}
			cwd = parent
		}
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return nil, fmt.Errorf("invalid web root: %w", err)
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("web root must be a directory")
	}
	cfg.AllowedHosts = append([]string(nil), cfg.AllowedHosts...)
	return &httpHandler{store: store, cfg: cfg, webRoot: root, readTimeout: 10 * time.Second}, nil
}

func respondJSON(w http.ResponseWriter, r *http.Request, status int, data any) {
	var body []byte
	if status != 204 {
		var err error
		body, err = json.Marshal(data)
		if err != nil {
			status = 500
			body = []byte(`{"error":"Internal server error"}`)
		}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	if r.Method != "HEAD" {
		_, _ = w.Write(body)
	}
}
func respondHTTPError(w http.ResponseWriter, r *http.Request, err error) {
	status, message := 500, "Internal server error"
	var api *APIError
	if errors.As(err, &api) {
		status, message = api.Status, api.Message
	}
	if r.ContentLength != 0 || len(r.TransferEncoding) > 0 {
		r.Close = true
		w.Header().Set("Connection", "close")
	}
	respondJSON(w, r, status, map[string]any{"error": message})
}
func sessionToken(r *http.Request) (string, error) {
	values := r.Header.Values("Authorization")
	if len(values) > 0 {
		if len(values) != 1 || !strings.HasPrefix(values[0], "Bearer ") || len(values[0]) <= 7 {
			return "", apiError("Authentication required", 401)
		}
		return values[0][7:], nil
	}
	cookies := r.Header.Values("Cookie")
	if len(cookies) != 1 {
		return "", apiError("Authentication required", 401)
	}
	count := 0
	for _, part := range strings.Split(cookies[0], ";") {
		if strings.TrimSpace(strings.SplitN(part, "=", 2)[0]) == "daymark_session" {
			count++
		}
	}
	if count != 1 {
		return "", apiError("Authentication required", 401)
	}
	c, err := r.Cookie("daymark_session")
	if err != nil || c.Value == "" {
		return "", apiError("Authentication required", 401)
	}
	return c.Value, nil
}
func (h *httpHandler) sessionCookie(r *http.Request, token string, expire bool) string {
	value := "daymark_session=" + token + "; Path=/; HttpOnly; SameSite=Strict; Max-Age="
	if expire {
		value += "0"
	} else {
		value += "2592000"
	}
	if h.cfg.PublicOrigin != "" || h.cfg.TLSCert != "" || r.TLS != nil {
		value += "; Secure"
	}
	return value
}
func (h *httpHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if recover() != nil {
			respondHTTPError(w, r, fmt.Errorf("internal panic"))
		}
	}()
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(h.readTimeout))
	if err := h.dispatch(w, r); err != nil {
		respondHTTPError(w, r, err)
	}
}
func (h *httpHandler) dispatch(w http.ResponseWriter, r *http.Request) error {
	if err := checkFraming(r); err != nil {
		return err
	}
	if err := checkRequestSecurity(h.cfg, r); err != nil {
		return err
	}
	path := r.URL.Path
	if (r.Method == "GET" || r.Method == "HEAD") && path == "/api/auth/setup" {
		required, err := h.store.SetupRequired()
		if err != nil {
			return err
		}
		respondJSON(w, r, 200, map[string]any{"setupRequired": required})
		return nil
	}
	if r.Method == "POST" && path == "/api/auth/setup" {
		peer, _, _ := net.SplitHostPort(r.RemoteAddr)
		if retry := h.setupLimiter.begin(peer); retry != 0 {
			w.Header().Set("Retry-After", strconv.Itoa(retry))
			return apiError("Too many setup attempts", 429)
		}
		failed := true
		defer func() { h.setupLimiter.finish(peer, failed) }()
		data, err := readRequestJSON(w, r)
		if err != nil {
			return err
		}
		key, okK := data["setupKey"].(string)
		username, okU := data["username"].(string)
		password, okP := data["password"].(string)
		if len(data) != 3 || !okK || !okU || !okP {
			return apiError("Expected setupKey, username and password strings")
		}
		login, err := h.store.CompleteSetup(key, username, password)
		if err != nil {
			return err
		}
		failed = false
		token, _ := login["token"].(string)
		w.Header().Set("Set-Cookie", h.sessionCookie(r, token, false))
		respondJSON(w, r, 201, login)
		return nil
	}
	if r.Method == "POST" && path == "/api/auth/login" {
		peer, _, _ := net.SplitHostPort(r.RemoteAddr)
		if retry := h.limiter.begin(peer); retry != 0 {
			w.Header().Set("Retry-After", strconv.Itoa(retry))
			return apiError("Too many login attempts", 429)
		}
		failed := true
		defer func() { h.limiter.finish(peer, failed) }()
		value, err := readRequestValue(w, r, true)
		if err != nil {
			return err
		}
		data, _ := value.(map[string]any)
		username, okU := data["username"].(string)
		password, okP := data["password"].(string)
		if len(data) != 2 || !okU || !okP {
			username, password = "", ""
		}
		login, err := h.store.Login(username, password)
		if err != nil {
			return err
		}
		failed = false
		token, _ := login["token"].(string)
		w.Header().Set("Set-Cookie", h.sessionCookie(r, token, false))
		respondJSON(w, r, 200, login)
		return nil
	}
	if path == "/api" || strings.HasPrefix(path, "/api/") {
		token, err := sessionToken(r)
		if err != nil {
			return err
		}
		session, err := h.store.Session(token)
		if err != nil {
			return err
		}
		if (r.Method == "GET" || r.Method == "HEAD") && path == "/api/auth/session" {
			respondJSON(w, r, 200, map[string]any{"username": session["username"], "expiresAt": session["expiresAt"]})
			return nil
		}
		if r.Method == "POST" && path == "/api/auth/logout" {
			if err := h.store.Logout(token); err != nil {
				return err
			}
			w.Header().Set("Set-Cookie", h.sessionCookie(r, "", true))
			respondJSON(w, r, 204, nil)
			return nil
		}
		userID, _ := session["userId"].(string)
		store, err := h.store.ForUser(userID)
		if err != nil {
			return err
		}
		if r.Method == "GET" || r.Method == "HEAD" {
			if path == "/api/state" {
				query, err := url.ParseQuery(r.URL.RawQuery)
				if err != nil {
					return apiError("Invalid query")
				}
				dates := query["date"]
				if len(dates) > 1 {
					return apiError("Supply only one date")
				}
				on := time.Now().Format("2006-01-02")
				if len(dates) == 1 {
					on = dates[0]
				}
				state, err := store.State(on)
				if err != nil {
					return err
				}
				respondJSON(w, r, 200, state)
				return nil
			}
			if path == "/api/export" {
				data, err := store.Export()
				if err != nil {
					return err
				}
				w.Header().Set("Content-Disposition", `attachment; filename="tasks-backup.json"`)
				respondJSON(w, r, 200, data)
				return nil
			}
		}
		if r.Method == "POST" && (path == "/api/occurrences/complete" || path == "/api/occurrences/undo") {
			data, err := readRequestJSON(w, r)
			if err != nil {
				return err
			}
			var result map[string]any
			if path == "/api/occurrences/complete" {
				result, err = store.Complete(data)
			} else {
				result, err = store.Undo(data)
			}
			if err != nil {
				return err
			}
			respondJSON(w, r, 200, result)
			return nil
		}
		if r.Method == "POST" && path == "/api/tasks" {
			data, err := readRequestJSON(w, r)
			if err != nil {
				return err
			}
			task, err := store.Create(data)
			if err != nil {
				return err
			}
			respondJSON(w, r, 201, task)
			return nil
		}
		if (r.Method == "PUT" || r.Method == "DELETE") && strings.HasPrefix(path, "/api/tasks/") && strings.Count(path, "/") == 3 {
			id := strings.TrimPrefix(path, "/api/tasks/")
			if r.Method == "PUT" {
				data, err := readRequestJSON(w, r)
				if err != nil {
					return err
				}
				task, err := store.Update(id, data)
				if err != nil {
					return err
				}
				respondJSON(w, r, 200, task)
				return nil
			}
			if err := store.Archive(id); err != nil {
				return err
			}
			respondJSON(w, r, 204, nil)
			return nil
		}
	}
	if r.Method == "GET" || r.Method == "HEAD" {
		if path == "/health" {
			respondJSON(w, r, 200, map[string]any{"status": "ok", "version": Version})
			return nil
		}
		if path != "/api" && !strings.HasPrefix(path, "/api/") {
			return serveStatic(w, r, h.webRoot, []string{h.store.Path, h.cfg.DB, h.cfg.TLSCert, h.cfg.TLSKey})
		}
	}
	switch r.Method {
	case "GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS":
		return apiError("Not found", 404)
	default:
		return apiError("Method not allowed", 405)
	}
}

func checkFraming(r *http.Request) error {
	if len(r.TransferEncoding) > 0 || r.Header.Get("Transfer-Encoding") != "" {
		return apiError("Chunked request bodies are not supported")
	}
	lengths := r.Header.Values("Content-Length")
	if len(lengths) > 1 || r.ContentLength < 0 || r.ContentLength > 65536 {
		return apiError("Invalid Content-Length or request body exceeds 64 KiB")
	}
	if len(lengths) == 1 {
		s := lengths[0]
		if len(s) == 0 || len(s) > 6 {
			return apiError("Invalid Content-Length or request body exceeds 64 KiB")
		}
		for _, c := range s {
			if c < '0' || c > '9' {
				return apiError("Invalid Content-Length or request body exceeds 64 KiB")
			}
		}
		n, err := strconv.ParseInt(s, 10, 64)
		if err != nil || n > 65536 || n != r.ContentLength {
			return apiError("Invalid Content-Length or request body exceeds 64 KiB")
		}
	}
	return nil
}

func readRequestJSON(w http.ResponseWriter, r *http.Request) (map[string]any, error) {
	value, err := readRequestValue(w, r, false)
	if err != nil {
		return nil, err
	}
	data, ok := value.(map[string]any)
	if !ok {
		return nil, apiError("Expected a JSON object")
	}
	return data, nil
}

func readRequestValue(w http.ResponseWriter, r *http.Request, login bool) (any, error) {
	if err := checkFraming(r); err != nil {
		return nil, err
	}
	if r.ContentLength <= 0 || r.ContentLength > 65536 {
		return nil, apiError("JSON request body must be between 1 byte and 64 KiB")
	}
	ct, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || ct != "application/json" {
		return nil, apiError("Content-Type must be application/json")
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 65536))
	if err != nil {
		return nil, apiError("Invalid JSON request body")
	}
	if int64(len(body)) != r.ContentLength {
		return nil, apiError("Incomplete JSON request body")
	}
	if !utf8.Valid(body) {
		return nil, apiError("Invalid JSON request body")
	}
	validUnicode := validJSONUnicode(body)
	if !validUnicode && !login {
		return nil, apiError("Invalid JSON request body")
	}
	if r.URL.Path == "/api/auth/setup" && !uniqueJSONObjectKeys(body) {
		return nil, apiError("Expected unique setup fields")
	}
	d := json.NewDecoder(bytes.NewReader(body))
	d.UseNumber()
	var value any
	if err := d.Decode(&value); err != nil {
		return nil, apiError("Invalid JSON request body")
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return nil, apiError("Invalid JSON request body")
	}
	// Invalid credential text follows the same dummy hash and generic 401 as
	// every other invalid credential shape; never authenticate replacement text.
	if !validUnicode {
		return nil, nil
	}
	return value, nil
}

// Setup credentials require an exact object, not last-value-wins decoding.
func uniqueJSONObjectKeys(body []byte) bool {
	d := json.NewDecoder(bytes.NewReader(body))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return false
	}
	seen := map[string]bool{}
	for d.More() {
		token, err = d.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return false
		}
		seen[key] = true
		var value json.RawMessage
		if d.Decode(&value) != nil {
			return false
		}
	}
	_, err = d.Token()
	return err == nil
}

// encoding/json replaces unpaired UTF-16 surrogates. Reject them rather than
// silently changing credential or task text before validation.
func validJSONUnicode(b []byte) bool {
	for i := 0; i < len(b); i++ {
		if b[i] != '\\' {
			continue
		}
		i++
		if i >= len(b) {
			return false
		}
		if b[i] != 'u' {
			continue
		}
		if i+4 >= len(b) {
			return false
		}
		n, err := strconv.ParseUint(string(b[i+1:i+5]), 16, 16)
		if err != nil {
			return false
		}
		i += 4
		if n >= 0xdc00 && n <= 0xdfff {
			return false
		}
		if n >= 0xd800 && n <= 0xdbff {
			if i+6 >= len(b) || b[i+1] != '\\' || b[i+2] != 'u' {
				return false
			}
			low, err := strconv.ParseUint(string(b[i+3:i+7]), 16, 16)
			if err != nil || low < 0xdc00 || low > 0xdfff {
				return false
			}
			i += 6
		}
	}
	return true
}

func serveStatic(w http.ResponseWriter, r *http.Request, root string, private []string) error {
	missing := func() error { return apiError("Not found", 404) }
	path := r.URL.Path
	if strings.ContainsAny(path, "\\\x00") {
		return missing()
	}
	for _, part := range strings.Split(path, "/") {
		if strings.HasPrefix(part, ".") {
			return missing()
		}
	}
	name := strings.TrimPrefix(path, "/")
	if path == "/" {
		name = "index.html"
	}
	dir, err := os.OpenRoot(root)
	if err != nil {
		return missing()
	}
	defer dir.Close()
	parts := strings.Split(name, "/")
	for i := range parts {
		info, err := dir.Lstat(strings.Join(parts[:i+1], "/"))
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return missing()
		}
	}
	f, err := dir.Open(name)
	if err != nil {
		return missing()
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return missing()
	}
	target := filepath.Join(root, filepath.FromSlash(name))
	for _, file := range private {
		if file == "" {
			continue
		}
		abs, err := filepath.Abs(file)
		if err != nil {
			return missing()
		}
		// SQLite resolves a database alias before choosing its sidecar paths.
		// Protect both spellings, including sidecars that do not exist yet.
		canonical, resolveErr := filepath.EvalSymlinks(abs)
		if resolveErr != nil {
			canonical = abs
		}
		for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
			if target == abs+suffix || target == canonical+suffix {
				return missing()
			}
			other, err := os.Stat(canonical + suffix)
			if err == nil && os.SameFile(info, other) {
				return missing()
			}
		}
	}
	contentType := mime.TypeByExtension(filepath.Ext(name))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	w.WriteHeader(200)
	if r.Method != "HEAD" {
		_, _ = io.Copy(w, f)
	}
	return nil
}

func checkRequestSecurity(cfg Config, r *http.Request) error {
	scheme := "http"
	if cfg.TLSCert != "" || r.TLS != nil {
		scheme = "https"
	}
	o, err := parseHTTPOrigin(scheme+"://"+r.Host, false)
	if err != nil {
		return apiError("Host is not allowed")
	}
	allowed := false
	for _, host := range append([]string{"localhost", "127.0.0.1", "::1", "10.0.2.2", "hermesdan.tail1a7c8f.ts.net"}, cfg.AllowedHosts...) {
		if strings.EqualFold(host, o.host) {
			allowed = true
		}
	}
	var public httpOrigin
	if cfg.PublicOrigin != "" {
		public, err = parseHTTPOrigin(cfg.PublicOrigin, false)
		if err != nil {
			return apiError("Invalid browser origin")
		}
		allowed = allowed || public.host == o.host
	}
	if ip := net.ParseIP(o.host); ip != nil {
		for _, cidr := range []string{"100.64.0.0/10", "fd7a:115c:a1e0::/48"} {
			_, network, _ := net.ParseCIDR(cidr)
			allowed = allowed || network.Contains(ip)
		}
	}
	if !allowed {
		return apiError("Host is not allowed")
	}
	peer, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		peer = ""
	}
	if strings.HasPrefix(r.URL.Path, "/api") && !(scheme == "https" || cfg.AllowInsecureHTTP || (cfg.PublicOrigin != "" && isLoopback(peer)) || (isLoopback(cfg.Host) && isLoopback(peer) && isLoopback(o.host))) {
		return apiError("HTTPS is required for authentication and API data", 403)
	}
	switch r.Method {
	case "POST", "PUT", "DELETE", "PATCH":
		if site := r.Header.Get("Sec-Fetch-Site"); site == "cross-site" || site == "same-site" {
			return apiError("Cross-origin browser writes are not allowed")
		}
		expected := o
		if cfg.PublicOrigin != "" {
			expected = public
		}
		for _, name := range []string{"Origin", "Referer"} {
			values := r.Header.Values(name)
			if len(values) > 1 {
				return apiError("Invalid browser origin")
			}
			if len(values) == 1 {
				got, err := parseHTTPOrigin(values[0], name == "Referer")
				if err != nil || got != expected {
					return apiError("Cross-origin browser writes are not allowed")
				}
			}
		}
	}
	return nil
}

type httpOrigin struct {
	scheme, host string
	port         int
}

func isLoopback(host string) bool {
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback()
	}
	return strings.EqualFold(host, "localhost")
}

func parseHTTPOrigin(value string, referer bool) (httpOrigin, error) {
	invalid := func() (httpOrigin, error) {
		return httpOrigin{}, fmt.Errorf("expected an HTTP origin without credentials, path, query or fragment")
	}
	if strings.ContainsAny(value, "\\#") || strings.IndexFunc(value, unicode.IsSpace) >= 0 {
		return invalid()
	}
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.Opaque != "" {
		return invalid()
	}
	if strings.Contains(u.Hostname(), ":") && (net.ParseIP(u.Hostname()) == nil || !strings.HasPrefix(u.Host, "[")) {
		return invalid()
	}
	if !referer && (u.Path != "" || u.RawQuery != "" || u.ForceQuery) {
		return invalid()
	}
	if strings.HasSuffix(u.Host, ":") {
		return invalid()
	}
	port := 80
	if u.Scheme == "https" {
		port = 443
	}
	if u.Port() != "" {
		port, err = strconv.Atoi(u.Port())
		if err != nil || port < 1 || port > 65535 {
			return invalid()
		}
	}
	return httpOrigin{u.Scheme, strings.ToLower(u.Hostname()), port}, nil
}

// ValidateConfig rejects unsafe transports before the CLI opens a listener.
// The CLI must serve TLS with a minimum protocol version of TLS 1.2.
func ValidateConfig(cfg Config) error {
	if (cfg.TLSCert == "") != (cfg.TLSKey == "") {
		return fmt.Errorf("TLS requires both certificate and private key")
	}
	if cfg.TLSCert != "" {
		if _, err := tls.LoadX509KeyPair(cfg.TLSCert, cfg.TLSKey); err != nil {
			return fmt.Errorf("invalid TLS certificate/private key: %w", err)
		}
	}
	if cfg.PublicOrigin != "" {
		o, err := parseHTTPOrigin(cfg.PublicOrigin, false)
		if err != nil {
			return err
		}
		if o.scheme != "https" {
			return fmt.Errorf("public origin must be HTTPS")
		}
	}
	if !isLoopback(cfg.Host) && !cfg.AllowInsecureHTTP && cfg.TLSCert == "" {
		return fmt.Errorf("HTTP must bind loopback; use TLS or explicit encrypted-tailnet development opt-in")
	}
	if cfg.Port < 0 || cfg.Port > 65535 {
		return fmt.Errorf("invalid port")
	}
	for _, host := range cfg.AllowedHosts {
		if strings.ContainsAny(host, "/\\@?#") || strings.IndexFunc(host, unicode.IsSpace) >= 0 || host == "" {
			return fmt.Errorf("invalid allowed host")
		}
		if net.ParseIP(host) == nil {
			if strings.Contains(host, ":") {
				return fmt.Errorf("allowed hosts must not contain ports")
			}
			if _, err := parseHTTPOrigin("http://"+host, false); err != nil {
				return fmt.Errorf("invalid allowed host")
			}
		}
	}
	return nil
}
