package server

import (
	"reflect"
	"testing"
)

func TestStateLatestOverdueAndUpcomingOrder(t *testing.T) {
	root, s := scopedFixture(t)
	_, err := root.State("2026-11-14")
	wantStatus(t, err, 401)
	low := createFixtureTask(t, s, map[string]any{"title": "low", "repeat": "daily", "interval": 3, "startDate": "2026-11-01"})
	high := createFixtureTask(t, s, map[string]any{"title": "high", "priority": 2, "startDate": "2026-11-13"})
	future := createFixtureTask(t, s, map[string]any{"title": "future", "startDate": "2026-12-01"})
	state, err := s.State("2026-11-14")
	if err != nil {
		t.Fatal(err)
	}
	today := state["today"].([]map[string]any)
	upcoming := state["upcoming"].([]map[string]any)
	if len(today) != 2 || today[0]["taskId"] != high["id"] || today[1]["taskId"] != low["id"] {
		t.Fatal(state)
	}
	want := map[string]any{"occurrenceId": low["id"].(string) + "@2026-11-13", "taskId": low["id"], "title": "low", "notes": "", "category": "Personal", "repeat": "daily", "interval": 3, "priority": 0, "dueDate": "2026-11-13", "completed": false, "completedAt": nil, "overdue": true}
	if !reflect.DeepEqual(today[1], want) {
		t.Fatalf("%v != %v", today[1], want)
	}
	if len(upcoming) != 2 || upcoming[0]["dueDate"] != "2026-11-16" || upcoming[1]["taskId"] != future["id"] {
		t.Fatal(state)
	}
	if !reflect.DeepEqual(state["progress"], map[string]any{"completed": 0, "total": 2}) {
		t.Fatal(state)
	}
	_, err = s.State("0000-01-01")
	wantStatus(t, err, 400)
}
