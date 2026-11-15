package server

import (
	"context"
	"database/sql"
)

const taskSchema = `CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,notes TEXT NOT NULL,category TEXT NOT NULL,repeat TEXT NOT NULL,interval INTEGER NOT NULL,startDate TEXT NOT NULL,priority INTEGER NOT NULL,createdAt TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS completions(taskId TEXT NOT NULL REFERENCES tasks(id),dueDate TEXT NOT NULL,completedOn TEXT NOT NULL,completedAt TEXT NOT NULL,PRIMARY KEY(taskId,dueDate));`

func (s *Store) write(fn func(*sql.Conn) error) error {
	ctx := context.Background()
	c, err := s.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer c.Close()
	if _, err = c.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return err
	}
	defer c.ExecContext(ctx, "ROLLBACK")
	if err = fn(c); err != nil {
		return err
	}
	_, err = c.ExecContext(ctx, "COMMIT")
	return err
}
func (s *Store) requireOwner() error {
	if s.owner == "" {
		return apiError("Authentication required", 401)
	}
	return nil
}
func (s *Store) ForUser(id string) (*Store, error) {
	var exists int
	err := s.db.QueryRow("SELECT 1 FROM users WHERE id=?", id).Scan(&exists)
	if err == sql.ErrNoRows {
		return nil, apiError("Authentication required", 401)
	}
	if err != nil {
		return nil, err
	}
	return &Store{Path: s.Path, db: s.db, owner: id}, nil
}
func (s *Store) AdoptLegacy(username string) (int64, error) {
	var total int64
	err := s.write(func(c *sql.Conn) error {
		var id string
		err := c.QueryRowContext(context.Background(), "SELECT id FROM users WHERE username=?", username).Scan(&id)
		if err == sql.ErrNoRows {
			return apiError("User not found", 404)
		}
		if err != nil {
			return err
		}
		r, err := c.ExecContext(context.Background(), "UPDATE tasks SET ownerId=? WHERE ownerId IS NULL", id)
		if err != nil {
			return err
		}
		total, err = r.RowsAffected()
		return err
	})
	return total, err
}
func (s *Store) Create(data map[string]any) (map[string]any, error) {
	if err := s.requireOwner(); err != nil {
		return nil, err
	}
	task, err := taskFields(data)
	if err != nil {
		return nil, err
	}
	task["id"] = uuid()
	task["createdAt"] = utcNow()
	_, err = s.db.Exec("INSERT INTO tasks(title,notes,category,repeat,interval,startDate,priority,id,createdAt,ownerId) VALUES(?,?,?,?,?,?,?,?,?,?)", task["title"], task["notes"], task["category"], task["repeat"], task["interval"], task["startDate"], task["priority"], task["id"], task["createdAt"], s.owner)
	if err != nil {
		return nil, err
	}
	return task, nil
}

const taskColumns = "id,title,notes,category,repeat,interval,startDate,priority,createdAt,archived"

type scanner interface{ Scan(...any) error }

func scanTask(row scanner, archived bool) (map[string]any, error) {
	var id, title, notes, category, repeat, start, created string
	var interval, priority, archive int
	err := row.Scan(&id, &title, &notes, &category, &repeat, &interval, &start, &priority, &created, &archive)
	if err != nil {
		return nil, err
	}
	t := map[string]any{"id": id, "title": title, "notes": notes, "category": category, "repeat": repeat, "interval": interval, "startDate": start, "priority": priority, "createdAt": created}
	if archived {
		t["archived"] = archive
	}
	return t, nil
}
func (s *Store) Update(id string, data map[string]any) (map[string]any, error) {
	if err := s.requireOwner(); err != nil {
		return nil, err
	}
	fields, err := taskFields(data)
	if err != nil {
		return nil, err
	}
	var task map[string]any
	err = s.write(func(c *sql.Conn) error {
		r, err := c.ExecContext(context.Background(), "UPDATE tasks SET title=?,notes=?,category=?,repeat=?,interval=?,startDate=?,priority=? WHERE id=? AND ownerId=? AND archived=0", fields["title"], fields["notes"], fields["category"], fields["repeat"], fields["interval"], fields["startDate"], fields["priority"], id, s.owner)
		if err != nil {
			return err
		}
		n, err := r.RowsAffected()
		if err != nil {
			return err
		}
		if n == 0 {
			return apiError("Task not found", 404)
		}
		task, err = scanTask(c.QueryRowContext(context.Background(), "SELECT "+taskColumns+" FROM tasks WHERE id=? AND ownerId=?", id, s.owner), false)
		return err
	})
	return task, err
}
func (s *Store) Archive(id string) error {
	if err := s.requireOwner(); err != nil {
		return err
	}
	r, err := s.db.Exec("UPDATE tasks SET archived=1 WHERE id=? AND ownerId=?", id, s.owner)
	if err != nil {
		return err
	}
	n, err := r.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return apiError("Task not found", 404)
	}
	return nil
}
func readTasks(tx *sql.Tx, owner string, archived bool) ([]map[string]any, error) {
	query := "SELECT " + taskColumns + " FROM tasks WHERE ownerId=?"
	if !archived {
		query += " AND archived=0"
	}
	query += " ORDER BY createdAt,id"
	rows, err := tx.Query(query, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		task, err := scanTask(rows, archived)
		if err != nil {
			return nil, err
		}
		out = append(out, task)
	}
	return out, rows.Err()
}
func readCompletions(tx *sql.Tx, owner string) ([]map[string]any, error) {
	rows, err := tx.Query("SELECT c.taskId,c.dueDate,c.completedOn,c.completedAt FROM completions c JOIN tasks t ON t.id=c.taskId WHERE t.ownerId=? ORDER BY c.taskId,c.dueDate", owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, due, on, at string
		if err = rows.Scan(&id, &due, &on, &at); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"taskId": id, "dueDate": due, "completedOn": on, "completedAt": at})
	}
	return out, rows.Err()
}
func (s *Store) Export() (map[string]any, error) {
	if err := s.requireOwner(); err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	tasks, err := readTasks(tx, s.owner, true)
	if err != nil {
		return nil, err
	}
	completions, err := readCompletions(tx, s.owner)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"schemaVersion": 1, "tasks": tasks, "completions": completions}, nil
}
