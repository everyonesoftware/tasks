package server

import (
	"sort"
	"time"
)

func (s *Store) State(on string) (map[string]any, error) {
	if err := s.requireOwner(); err != nil {
		return nil, err
	}
	date, err := isoDate(on, "date")
	if err != nil {
		return nil, err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	tasks, err := readTasks(tx, s.owner, false)
	if err != nil {
		return nil, err
	}
	history, err := readCompletions(tx, s.owner)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	completions := map[string]map[string]any{}
	completedToday := map[string][]map[string]any{}
	for _, c := range history {
		id := c["taskId"].(string)
		completions[id+"@"+c["dueDate"].(string)] = c
		if c["completedOn"] == on && c["dueDate"].(string) < on {
			completedToday[id] = append(completedToday[id], c)
		}
	}
	today, upcoming := []map[string]any{}, []map[string]any{}
	order := map[string]int{}
	for index, task := range tasks {
		id := task["id"].(string)
		order[id] = index
		start, err := isoDate(task["startDate"], "startDate")
		if err != nil {
			return nil, err
		}
		latest, next := around(start, task["repeat"].(string), task["interval"].(int), date)
		occurrence := func(due time.Time) map[string]any {
			out := map[string]any{}
			for _, k := range []string{"title", "notes", "category", "repeat", "interval", "priority"} {
				out[k] = task[k]
			}
			dueString := due.Format("2006-01-02")
			out["occurrenceId"] = id + "@" + dueString
			out["taskId"] = id
			out["dueDate"] = dueString
			out["completed"] = false
			out["completedAt"] = nil
			if c := completions[id+"@"+dueString]; c != nil {
				out["completed"] = true
				out["completedAt"] = c["completedAt"]
			}
			out["overdue"] = due.Before(date)
			return out
		}
		if latest.Year() != 0 {
			c := completions[id+"@"+latest.Format("2006-01-02")]
			if c == nil || latest.Equal(date) || c["completedOn"] == on {
				today = append(today, occurrence(latest))
			}
		}
		for _, c := range completedToday[id] {
			due, err := isoDate(c["dueDate"], "dueDate")
			if err != nil {
				return nil, err
			}
			scheduled, _ := around(start, task["repeat"].(string), task["interval"].(int), due)
			if !due.Equal(latest) && scheduled.Equal(due) {
				today = append(today, occurrence(due))
			}
		}
		if next.Year() != 0 && !(task["repeat"] == "once" && completions[id+"@"+next.Format("2006-01-02")] != nil) {
			upcoming = append(upcoming, occurrence(next))
		}
	}
	less := func(a, b map[string]any) bool {
		if a["dueDate"] != b["dueDate"] {
			return a["dueDate"].(string) < b["dueDate"].(string)
		}
		if a["priority"] != b["priority"] {
			return a["priority"].(int) > b["priority"].(int)
		}
		return order[a["taskId"].(string)] < order[b["taskId"].(string)]
	}
	sort.Slice(today, func(i, j int) bool {
		if today[i]["completed"] != today[j]["completed"] {
			return today[i]["completed"] == false
		}
		return less(today[i], today[j])
	})
	sort.Slice(upcoming, func(i, j int) bool { return less(upcoming[i], upcoming[j]) })
	completed := 0
	for _, item := range today {
		if item["completed"] == true {
			completed++
		}
	}
	return map[string]any{"date": on, "tasks": tasks, "today": today, "upcoming": upcoming, "progress": map[string]any{"completed": completed, "total": len(today)}}, nil
}
