package server

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"testing"
	"time"
)

func TestCompleteSetupCreatesSessionAndConsumesKey(t *testing.T) {
	s := openFixture(t)
	key, _, err := s.GenerateSetupKey()
	if err != nil {
		t.Fatal(err)
	}
	login, err := s.CompleteSetup(key, "First", " fixture password ")
	if err != nil {
		t.Fatal(err)
	}
	if len(login) != 3 || login["username"] != "First" {
		t.Fatal(login)
	}
	session, err := s.Session(login["token"].(string))
	if err != nil || session["username"] != "First" {
		t.Fatalf("session=%v %v", session, err)
	}
	var storedTokenHash, storedSessionExpiry string
	if err = s.db.QueryRow("SELECT tokenHash,expiresAt FROM sessions").Scan(&storedTokenHash, &storedSessionExpiry); err != nil {
		t.Fatal(err)
	}
	tokenDigest := sha256.Sum256([]byte(login["token"].(string)))
	if storedTokenHash != hex.EncodeToString(tokenDigest[:]) || storedSessionExpiry != login["expiresAt"] {
		t.Fatal("raw session token or mismatched expiry")
	}
	sessionExpiry, err := time.Parse(time.RFC3339Nano, storedSessionExpiry)
	if err != nil || time.Until(sessionExpiry) < 29*24*time.Hour || time.Until(sessionExpiry) > 30*24*time.Hour {
		t.Fatal("invalid setup session lifetime")
	}
	var salt, digest []byte
	var rounds, keys int
	if err = s.db.QueryRow("SELECT salt,passwordHash,iterations FROM users").Scan(&salt, &digest, &rounds); err != nil {
		t.Fatal(err)
	}
	if len(salt) != 32 || rounds != iterations || hex.EncodeToString(digest) != hex.EncodeToString(passwordHash(" fixture password ", salt, rounds)) {
		t.Fatal("password not hashed compatibly")
	}
	if err = s.db.QueryRow("SELECT COUNT(*) FROM setup_state").Scan(&keys); err != nil || keys != 0 {
		t.Fatal("key not consumed", err)
	}
	_, err = s.CompleteSetup(key, "Second", "fixture-password")
	wantStatus(t, err, 409)
	if _, err = s.Login("FIRST", " fixture password "); err != nil {
		t.Fatal(err)
	}
}

func TestSetupKeyLifecycle(t *testing.T) {
	s := openFixture(t)
	required, err := s.SetupRequired()
	if err != nil || !required {
		t.Fatalf("required=%v err=%v", required, err)
	}
	before := time.Now()
	key, expiry, err := s.GenerateSetupKey()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(key)
	if err != nil || len(raw) < 32 {
		t.Fatal("key is not >=32 random base64url bytes")
	}
	when, err := time.Parse(time.RFC3339Nano, expiry)
	if err != nil || when.Before(before.Add(30*time.Minute)) || when.After(time.Now().Add(30*time.Minute)) {
		t.Fatalf("expiry=%s", expiry)
	}
	var hash, storedExpiry string
	if err = s.db.QueryRow("SELECT keyHash,expiresAt FROM setup_state WHERE id=1").Scan(&hash, &storedExpiry); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(key))
	if hash != hex.EncodeToString(sum[:]) || hash == key || storedExpiry != expiry {
		t.Fatal("raw or incompatible key storage")
	}
	next, _, err := s.GenerateSetupKey()
	if err != nil || next == key {
		t.Fatalf("rotation: %v", err)
	}
	reopened, err := Open(s.Path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if err = reopened.db.QueryRow("SELECT keyHash FROM setup_state").Scan(&hash); err != nil {
		t.Fatal(err)
	}
	sum = sha256.Sum256([]byte(next))
	if hash != hex.EncodeToString(sum[:]) {
		t.Fatal("rotation did not persist")
	}
	if _, err = s.CreateUser("Operator", "fixture-password"); err != nil {
		t.Fatal(err)
	}
	if required, err = reopened.SetupRequired(); err != nil || required {
		t.Fatalf("required after CLI=%v %v", required, err)
	}
	_, _, err = reopened.GenerateSetupKey()
	wantStatus(t, err, 409)
}
