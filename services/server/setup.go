package server

import (
	"context"
	"crypto/hmac"
	"database/sql"
	"encoding/base64"
	"time"
)

// SetupRequired discloses only whether the database has any accounts.
func (s *Store) SetupRequired() (bool, error) {
	var exists bool
	err := s.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users)").Scan(&exists)
	return !exists, err
}

// CompleteSetup holds SQLite's write lock across the account check, credential
// consumption and both inserts, including across independent server processes.
func (s *Store) CompleteSetup(key, username, password string) (map[string]any, error) {
	var login map[string]any
	err := s.write(func(c *sql.Conn) error {
		ctx := context.Background()
		var exists bool
		if err := c.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM users)").Scan(&exists); err != nil {
			return err
		}
		if exists {
			return apiError("Setup already completed", 409)
		}
		var storedHash, storedExpiry string
		err := c.QueryRowContext(ctx, "SELECT keyHash,expiresAt FROM setup_state WHERE id=1").Scan(&storedHash, &storedExpiry)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		raw, decodeErr := base64.RawURLEncoding.Strict().DecodeString(key)
		hash, hashErr := tokenHash(key)
		expires, expiryErr := time.Parse(time.RFC3339Nano, storedExpiry)
		if err == sql.ErrNoRows || decodeErr != nil || len(raw) != 32 || hashErr != nil || expiryErr != nil || !expires.After(time.Now()) || !hmac.Equal([]byte(hash), []byte(storedHash)) {
			return apiError("Invalid or expired setup key", 401)
		}
		if err := validateAccount(username, password); err != nil {
			return err
		}
		id, salt := uuid(), randBytes(32)
		digest := passwordHash(password, salt, iterations)
		token := base64.RawURLEncoding.EncodeToString(randBytes(32))
		tokenDigest, _ := tokenHash(token)
		expiry := time.Now().UTC().Add(30 * 24 * time.Hour).Format("2006-01-02T15:04:05.000000Z")
		if _, err := c.ExecContext(ctx, "INSERT INTO users VALUES(?,?,?,?,?)", id, username, salt, digest, iterations); err != nil {
			return err
		}
		if _, err := c.ExecContext(ctx, "INSERT INTO sessions VALUES(?,?,?)", tokenDigest, id, expiry); err != nil {
			return err
		}
		if _, err := c.ExecContext(ctx, "DELETE FROM setup_state"); err != nil {
			return err
		}
		login = map[string]any{"token": token, "username": username, "expiresAt": expiry}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return login, nil
}

// GenerateSetupKey explicitly rotates the sole operator-issued setup credential.
// Only its SHA-256 digest is persisted; callers must not log the returned key.
func (s *Store) GenerateSetupKey() (key, expiresAt string, err error) {
	key = base64.RawURLEncoding.EncodeToString(randBytes(32))
	hash, _ := tokenHash(key)
	expiresAt = time.Now().UTC().Add(30 * time.Minute).Format("2006-01-02T15:04:05.000000Z")
	err = s.write(func(c *sql.Conn) error {
		ctx := context.Background()
		var exists bool
		if e := c.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM users)").Scan(&exists); e != nil {
			return e
		}
		if exists {
			return apiError("Setup already completed", 409)
		}
		_, e := c.ExecContext(ctx, "INSERT INTO setup_state(id,keyHash,expiresAt) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET keyHash=excluded.keyHash,expiresAt=excluded.expiresAt", hash, expiresAt)
		return e
	})
	if err != nil {
		return "", "", err
	}
	return key, expiresAt, nil
}
