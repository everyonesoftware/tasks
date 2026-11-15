package server

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const iterations = 600000

var usernamePattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)
var dummySalt = randBytes(32)

func randBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}
func uuid() string {
	b := randBytes(16)
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func utcNow() string { return time.Now().UTC().Format("2006-01-02T15:04:05.000000Z") }
func passwordHash(password string, salt []byte, rounds int) []byte {
	b, err := pbkdf2.Key(sha256.New, password, salt, rounds, 32)
	if err != nil {
		return nil
	}
	return b
}
func validPassword(password string) bool {
	return utf8.ValidString(password) && utf8.RuneCountInString(password) >= 8 && utf8.RuneCountInString(password) <= 1024
}
func validateAccount(username, password string) error {
	if !usernamePattern.MatchString(username) {
		return apiError("Username must be 1..64 ASCII letters, digits, dot, underscore or hyphen")
	}
	if !validPassword(password) {
		return apiError("Password must be 8..1024 characters")
	}
	return nil
}
func tokenHash(token string) (string, error) {
	if len(token) < 1 || len(token) > 256 {
		return "", apiError("Authentication required", 401)
	}
	for _, b := range []byte(token) {
		if b > 127 {
			return "", apiError("Authentication required", 401)
		}
	}
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:]), nil
}
func (s *Store) CreateUser(username, password string) (string, error) {
	if err := validateAccount(username, password); err != nil {
		return "", err
	}
	id, salt := uuid(), randBytes(32)
	digest := passwordHash(password, salt, iterations)
	_, err := s.db.Exec("INSERT INTO users VALUES(?,?,?,?,?)", id, username, salt, digest, iterations)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			return "", apiError("Username already exists")
		}
		return "", err
	}
	return id, nil
}
func (s *Store) Login(username, password string) (map[string]any, error) {
	var id, name string
	var salt, digest []byte
	rounds := iterations
	valid := usernamePattern.MatchString(username) && validPassword(password)
	found := false
	if valid {
		err := s.db.QueryRow("SELECT id,username,salt,passwordHash,iterations FROM users WHERE username=?", username).Scan(&id, &name, &salt, &digest, &rounds)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		found = err == nil
	}
	if !found {
		salt = dummySalt
		digest = make([]byte, 32)
		rounds = iterations
	}
	if !valid {
		password = ""
	}
	hashed := passwordHash(password, salt, rounds)
	if !hmac.Equal(hashed, digest) || !found {
		return nil, apiError("Invalid username or password", 401)
	}
	token := base64.RawURLEncoding.EncodeToString(randBytes(32))
	hash, _ := tokenHash(token)
	expiry := time.Now().UTC().Add(30 * 24 * time.Hour).Format("2006-01-02T15:04:05.000000Z")
	// The credential-version predicate and insertion are one atomic SQL write.
	result, err := s.db.Exec("INSERT INTO sessions SELECT ?,id,? FROM users WHERE id=? AND passwordHash=? AND salt=?", hash, expiry, id, digest, salt)
	if err != nil {
		return nil, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, apiError("Invalid username or password", 401)
	}
	return map[string]any{"token": token, "username": name, "expiresAt": expiry}, nil
}
func (s *Store) Session(token string) (map[string]any, error) {
	hash, err := tokenHash(token)
	if err != nil {
		return nil, err
	}
	var id, name, expiry string
	err = s.db.QueryRow("SELECT userId,username,expiresAt FROM sessions JOIN users ON users.id=sessions.userId WHERE tokenHash=?", hash).Scan(&id, &name, &expiry)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, apiError("Authentication required", 401)
		}
		return nil, err
	}
	when, err := time.Parse(time.RFC3339Nano, expiry)
	if err != nil || !when.After(time.Now()) {
		return nil, apiError("Authentication required", 401)
	}
	return map[string]any{"userId": id, "username": name, "expiresAt": expiry}, nil
}
func (s *Store) ResetPassword(username, password string) error {
	if err := validateAccount(username, password); err != nil {
		return err
	}
	salt := randBytes(32)
	digest := passwordHash(password, salt, iterations)
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// First operation obtains SQLite's write lock; no read-to-write upgrade race.
	result, err := tx.Exec("UPDATE users SET salt=?,passwordHash=?,iterations=? WHERE username=?", salt, digest, iterations, username)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return apiError("User not found", 404)
	}
	if _, err = tx.Exec("DELETE FROM sessions WHERE userId=(SELECT id FROM users WHERE username=?)", username); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) Logout(token string) error {
	hash, err := tokenHash(token)
	if err != nil {
		return err
	}
	_, err = s.db.Exec("DELETE FROM sessions WHERE tokenHash=?", hash)
	return err
}
