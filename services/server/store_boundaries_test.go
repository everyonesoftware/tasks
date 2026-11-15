package server

import "testing"

func TestYearOneJanuaryFirstIsARealOccurrence(t *testing.T) {
	_, s := scopedFixture(t)
	task := createFixtureTask(t, s, map[string]any{"startDate": "0001-01-01"})
	state, err := s.State("0001-01-01")
	if err != nil {
		t.Fatal(err)
	}
	today := state["today"].([]map[string]any)
	if len(today) != 1 || today[0]["dueDate"] != "0001-01-01" {
		t.Fatalf("year-one occurrence lost: %v", state)
	}
	state, err = s.Complete(map[string]any{"taskId": task["id"], "dueDate": "0001-01-01", "date": "0001-01-01"})
	if err != nil || state["progress"].(map[string]any)["completed"] != 1 {
		t.Fatalf("%v %v", state, err)
	}
	later := createFixtureTask(t, s, map[string]any{"startDate": "0001-01-02", "repeat": "daily"})
	_, err = s.Complete(map[string]any{"taskId": later["id"], "dueDate": "0001-01-01", "date": "0001-01-01"})
	wantStatus(t, err, 400)
}
