package server

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func openFixture(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "nested", "fixture.sqlite3"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func wantStatus(t *testing.T, err error, status int) {
	t.Helper()
	var api *APIError
	if !errors.As(err, &api) || api.Status != status {
		t.Fatalf("want %d APIError, got %v", status, err)
	}
}
func TestAuthProvisionLoginSessionCompatibility(t *testing.T) {
	s := openFixture(t)
	uid, err := s.CreateUser("Alice", " fixture password ")
	if err != nil {
		t.Fatal(err)
	}
	var salt, digest []byte
	var rounds int
	if err = s.db.QueryRow("SELECT salt,passwordHash,iterations FROM users WHERE id=?", uid).Scan(&salt, &digest, &rounds); err != nil {
		t.Fatal(err)
	}
	if len(salt) != 32 || rounds != 600000 || hex.EncodeToString(passwordHash(" fixture password ", salt, rounds)) != hex.EncodeToString(digest) {
		t.Fatal("incompatible password record")
	}
	_, err = s.CreateUser("aLICE", "fixture-password")
	wantStatus(t, err, 400)
	login, err := s.Login("ALICE", " fixture password ")
	if err != nil {
		t.Fatal(err)
	}
	token := login["token"].(string)
	if len(token) < 43 || login["username"] != "Alice" {
		t.Fatal(login)
	}
	session, err := s.Session(token)
	if err != nil || session["userId"] != uid || len(session) != 3 {
		t.Fatalf("%v %v", session, err)
	}
	var stored string
	if err = s.db.QueryRow("SELECT tokenHash FROM sessions").Scan(&stored); err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256([]byte(token))
	if stored != hex.EncodeToString(hash[:]) {
		t.Fatal("raw or incompatible token hash")
	}
	if err = s.Logout(token); err != nil {
		t.Fatal(err)
	}
	_, err = s.Session(token)
	wantStatus(t, err, 401)
	_, err = s.Login("Alice", "bad")
	wantStatus(t, err, 401)
	_, err = s.Login("missing", "fixture-password")
	wantStatus(t, err, 401)
	for _, c := range [][2]string{{"bad name", "password"}, {"é", "password"}, {"Good", "short"}, {"Good", strings.Repeat("a", 1025)}} {
		_, err = s.CreateUser(c[0], c[1])
		wantStatus(t, err, 400)
	}
	for _, bad := range []string{"", strings.Repeat("a", 257), "é"} {
		_, err = s.Session(bad)
		wantStatus(t, err, 401)
	}
	// Fixed Python hashlib.pbkdf2_hmac('sha256', b'password', b'salt', 1).
	if got := hex.EncodeToString(passwordHash("password", []byte("salt"), 1)); got != "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b" {
		t.Fatal(got)
	}
	// Insert a Python-compatible session with six fractional digits.
	hash = sha256.Sum256([]byte("python-token"))
	_, err = s.db.Exec("INSERT INTO sessions VALUES(?,?,?)", hex.EncodeToString(hash[:]), uid, time.Now().UTC().Add(time.Hour).Format("2006-01-02T15:04:05.000000Z"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Session("python-token"); err != nil {
		t.Fatal(err)
	}
	for _, expiry := range []string{"2000-01-01T00:00:00Z", "not-a-timestamp"} {
		if _, err = s.db.Exec("UPDATE sessions SET expiresAt=?", expiry); err != nil {
			t.Fatal(err)
		}
		_, err = s.Session("python-token")
		wantStatus(t, err, 401)
	}
}
