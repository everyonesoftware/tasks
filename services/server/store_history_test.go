package server

import (
	"reflect"
	"testing"
)

func TestStateRetainsOlderCyclesCompletedTodayAndSortsLast(t *testing.T) {
	_, s := scopedFixture(t)
	daily := createFixtureTask(t, s, map[string]any{"repeat": "daily", "priority": 2, "startDate": "2026-11-13"})
	once := createFixtureTask(t, s, nil)
	state, err := s.Complete(map[string]any{"taskId": daily["id"], "dueDate": "2026-11-13", "date": "2026-11-14"})
	if err != nil {
		t.Fatal(err)
	}
	today := state["today"].([]map[string]any)
	if len(today) != 3 || today[0]["taskId"] != daily["id"] || today[0]["dueDate"] != "2026-11-14" || today[1]["taskId"] != once["id"] || today[2]["dueDate"] != "2026-11-13" || today[2]["completed"] != true {
		t.Fatal(state)
	}
	if !reflect.DeepEqual(state["progress"], map[string]any{"completed": 1, "total": 3}) {
		t.Fatal(state)
	}
	tomorrow, err := s.State("2026-11-15")
	if err != nil || len(tomorrow["today"].([]map[string]any)) != 2 {
		t.Fatalf("%v %v", tomorrow, err)
	}
	// A changed recurrence cannot resurrect a no-longer-scheduled old completion.
	_, err = s.Update(daily["id"].(string), map[string]any{"title": "changed", "startDate": "2026-12-01", "repeat": "monthly"})
	if err != nil {
		t.Fatal(err)
	}
	state, err = s.State("2026-11-14")
	if err != nil || len(state["today"].([]map[string]any)) != 1 {
		t.Fatalf("%v %v", state, err)
	}
	out, err := s.Export()
	if err != nil || len(out["completions"].([]map[string]any)) != 1 {
		t.Fatalf("lost history %v %v", out, err)
	}
}
func TestStateCompletedOnceNeverUpcomingAndUpcomingUsesDates(t *testing.T) {
	_, s := scopedFixture(t)
	early := createFixtureTask(t, s, map[string]any{"repeat": "weekly", "startDate": "2026-11-15"})
	late := createFixtureTask(t, s, map[string]any{"startDate": "2026-11-16"})
	once := createFixtureTask(t, s, map[string]any{"startDate": "2026-12-01"})
	for _, task := range []map[string]any{early, once} {
		if _, err := s.Complete(map[string]any{"taskId": task["id"], "dueDate": task["startDate"], "date": task["startDate"]}); err != nil {
			t.Fatal(err)
		}
	}
	state, err := s.State("2026-11-14")
	if err != nil {
		t.Fatal(err)
	}
	upcoming := state["upcoming"].([]map[string]any)
	if len(upcoming) != 2 || upcoming[0]["taskId"] != early["id"] || upcoming[1]["taskId"] != late["id"] {
		t.Fatal(state)
	}
}
