package server

import (
	"context"
	"database/sql"
	"unicode/utf8"
)

func (s *Store) Complete(data map[string]any) (map[string]any, error) {
	return s.completion(data, false)
}
func (s *Store) Undo(data map[string]any) (map[string]any, error) { return s.completion(data, true) }
func (s *Store) completion(data map[string]any, undo bool) (map[string]any, error) {
	if err := s.requireOwner(); err != nil {
		return nil, err
	}
	if len(data) != 3 {
		return nil, apiError("Expected taskId, dueDate and date")
	}
	for _, k := range []string{"taskId", "dueDate", "date"} {
		if _, ok := data[k]; !ok {
			return nil, apiError("Expected taskId, dueDate and date")
		}
	}
	id, ok := data["taskId"].(string)
	if !ok || id == "" || utf8.RuneCountInString(id) > 100 || !utf8.ValidString(id) {
		return nil, apiError("Invalid taskId")
	}
	due, err := isoDate(data["dueDate"], "dueDate")
	if err != nil {
		return nil, err
	}
	on, err := isoDate(data["date"], "date")
	if err != nil {
		return nil, err
	}
	err = s.write(func(c *sql.Conn) error {
		task, err := scanTask(c.QueryRowContext(context.Background(), "SELECT "+taskColumns+" FROM tasks WHERE id=? AND ownerId=? AND archived=0", id, s.owner), false)
		if err == sql.ErrNoRows {
			return apiError("Task not found", 404)
		}
		if err != nil {
			return err
		}
		start, err := isoDate(task["startDate"], "startDate")
		if err != nil {
			return err
		}
		latest, _ := around(start, task["repeat"].(string), task["interval"].(int), due)
		if due.After(on) || !latest.Equal(due) {
			return apiError("Occurrence must be scheduled and not in the future")
		}
		if undo {
			_, err = c.ExecContext(context.Background(), "DELETE FROM completions WHERE taskId=? AND dueDate=?", id, due.Format("2006-01-02"))
		} else {
			_, err = c.ExecContext(context.Background(), "INSERT INTO completions(taskId,dueDate,completedOn,completedAt) VALUES(?,?,?,?) ON CONFLICT(taskId,dueDate) DO NOTHING", id, due.Format("2006-01-02"), on.Format("2006-01-02"), utcNow())
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.State(on.Format("2006-01-02"))
}
