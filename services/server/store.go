package server

import (
	"context"
	"database/sql"
	_ "modernc.org/sqlite"
	"os"
	"path/filepath"
)

const authSchema = `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, salt BLOB NOT NULL, passwordHash BLOB NOT NULL, iterations INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(tokenHash TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),expiresAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS setup_state(id INTEGER PRIMARY KEY CHECK(id=1),keyHash TEXT NOT NULL,expiresAt TEXT NOT NULL);`

type Store struct {
	Path  string
	db    *sql.DB
	owner string
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	// A shared pool serializes writes and guarantees per-connection PRAGMAs;
	// SQLite's lock still serializes independent processes and Store instances.
	db.SetMaxOpenConns(1)
	s := &Store{Path: path, db: db}
	for _, query := range []string{"PRAGMA busy_timeout=10000", "PRAGMA foreign_keys=ON", "PRAGMA journal_mode=WAL", authSchema} {
		if _, err = db.Exec(query); err != nil {
			db.Close()
			return nil, err
		}
	}
	err = s.write(func(c *sql.Conn) error {
		if _, e := c.ExecContext(context.Background(), taskSchema); e != nil {
			return e
		}
		rows, e := c.QueryContext(context.Background(), "PRAGMA table_info(tasks)")
		if e != nil {
			return e
		}
		found := false
		for rows.Next() {
			var cid, nn, pk int
			var name, typ string
			var def any
			if e = rows.Scan(&cid, &name, &typ, &nn, &def, &pk); e != nil {
				rows.Close()
				return e
			}
			if name == "ownerId" {
				found = true
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		if !found {
			if _, e = c.ExecContext(context.Background(), "ALTER TABLE tasks ADD COLUMN ownerId TEXT REFERENCES users(id)"); e != nil {
				return e
			}
		}
		_, e = c.ExecContext(context.Background(), "CREATE INDEX IF NOT EXISTS tasks_owner ON tasks(ownerId)")
		return e
	})
	if err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) Close() error { return s.db.Close() }
