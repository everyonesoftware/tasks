package server

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestSetupSchemaUpgradePreservesUnownedLegacyData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "daymark.sqlite3")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(taskSchema + `
 CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, salt BLOB NOT NULL, passwordHash BLOB NOT NULL, iterations INTEGER NOT NULL);
 CREATE TABLE sessions(tokenHash TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),expiresAt TEXT NOT NULL);
 INSERT INTO tasks VALUES('legacy','Private legacy title','notes','Personal','once',1,'2026-01-01',1,'2026-01-01T00:00:00Z',0);
 INSERT INTO completions VALUES('legacy','2026-01-01','2026-01-01','2026-01-01T00:00:00Z');`)
	if err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	key, _, err := s.GenerateSetupKey()
	if err != nil {
		t.Fatal(err)
	}
	login, err := s.CompleteSetup(key, "First", "fixture-password")
	if err != nil {
		t.Fatal(err)
	}
	session, err := s.Session(login["token"].(string))
	if err != nil {
		t.Fatal(err)
	}
	owned, err := s.ForUser(session["userId"].(string))
	if err != nil {
		t.Fatal(err)
	}
	exported, err := owned.Export()
	if err != nil {
		t.Fatal(err)
	}
	if len(exported["tasks"].([]map[string]any)) != 0 || len(exported["completions"].([]map[string]any)) != 0 {
		t.Fatal("legacy data adopted")
	}
	var owner sql.NullString
	var title string
	if err = s.db.QueryRow("SELECT title,ownerId FROM tasks WHERE id='legacy'").Scan(&title, &owner); err != nil || owner.Valid || title != "Private legacy title" {
		t.Fatal("legacy task modified", err)
	}
	var history int
	if err = s.db.QueryRow("SELECT COUNT(*) FROM completions WHERE taskId='legacy'").Scan(&history); err != nil || history != 1 {
		t.Fatal("legacy history modified", err)
	}
}
