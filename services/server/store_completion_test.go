package server

import (
	"reflect"
	"sync"
	"testing"
)

func TestCompletionLifecyclePersistenceAndIsolation(t *testing.T) {
	root, s := scopedFixture(t)
	uid, err := root.CreateUser("Other", "fixture-password")
	if err != nil {
		t.Fatal(err)
	}
	other, err := root.ForUser(uid)
	if err != nil {
		t.Fatal(err)
	}
	task := createFixtureTask(t, s, map[string]any{"repeat": "weekly", "startDate": "2026-11-12"})
	data := map[string]any{"taskId": task["id"], "dueDate": "2026-11-12", "date": "2026-11-14"}
	_, err = root.Complete(data)
	wantStatus(t, err, 401)
	_, err = other.Complete(data)
	wantStatus(t, err, 404)
	_, err = other.Undo(data)
	wantStatus(t, err, 404)
	state, err := s.Complete(data)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(state["progress"], map[string]any{"completed": 1, "total": 1}) {
		t.Fatal(state)
	}
	again, err := s.Complete(data)
	if err != nil || !reflect.DeepEqual(state, again) {
		t.Fatalf("not idempotent %v %v", again, err)
	}
	reopened, err := Open(s.Path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	scoped, err := reopened.ForUser(s.owner)
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := scoped.State("2026-11-14")
	if err != nil || !reflect.DeepEqual(persisted, state) {
		t.Fatalf("not persisted %v %v", persisted, err)
	}
	tomorrow, err := s.State("2026-11-15")
	if err != nil || len(tomorrow["today"].([]map[string]any)) != 0 {
		t.Fatalf("%v %v", tomorrow, err)
	}
	undone, err := s.Undo(data)
	if err != nil || undone["today"].([]map[string]any)[0]["completed"] != false {
		t.Fatalf("%v %v", undone, err)
	}
	again, err = s.Undo(data)
	if err != nil || !reflect.DeepEqual(again, undone) {
		t.Fatal("undo not idempotent", err)
	}
	if _, err = s.Complete(data); err != nil {
		t.Fatal(err)
	}
	if err = s.Archive(task["id"].(string)); err != nil {
		t.Fatal(err)
	}
	out, err := s.Export()
	if err != nil || len(out["completions"].([]map[string]any)) != 1 {
		t.Fatalf("history lost %v %v", out, err)
	}
	_, err = s.Complete(data)
	wantStatus(t, err, 404)
	_, err = s.Undo(data)
	wantStatus(t, err, 404)
}
func TestCompletionRejectsInvalidOccurrences(t *testing.T) {
	_, s := scopedFixture(t)
	task := createFixtureTask(t, s, map[string]any{"repeat": "weekly"})
	valid := map[string]any{"taskId": task["id"], "dueDate": "2026-11-14", "date": "2026-11-14"}
	for _, patch := range []map[string]any{nil, {}, {"extra": 1}, {"taskId": true}, {"taskId": "missing"}, {"taskId": ""}, {"dueDate": "2026-11-21"}, {"dueDate": "2026-11-13"}, {"dueDate": "2026-11-15", "date": "2026-11-16"}, {"date": "2026-02-30"}, {"dueDate": "2026-02-30"}} {
		data := map[string]any{}
		for k, v := range valid {
			data[k] = v
		}
		if patch == nil {
			data = nil
		} else if len(patch) == 0 {
			data = patch
		} else {
			for k, v := range patch {
				data[k] = v
			}
		}
		for _, method := range []func(map[string]any) (map[string]any, error){s.Complete, s.Undo} {
			if _, err := method(data); err == nil {
				t.Errorf("accepted %v", data)
			}
		}
	}
	out, err := s.Export()
	if err != nil || len(out["completions"].([]map[string]any)) != 0 {
		t.Fatalf("%v %v", out, err)
	}
}
func TestConcurrentCompletionIsIdempotent(t *testing.T) {
	_, s := scopedFixture(t)
	task := createFixtureTask(t, s, nil)
	data := map[string]any{"taskId": task["id"], "dueDate": "2026-11-14", "date": "2026-11-14"}
	independent, err := Open(s.Path)
	if err != nil {
		t.Fatal(err)
	}
	defer independent.Close()
	other, err := independent.ForUser(s.owner)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	states := make([]map[string]any, 12)
	for i := range states {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			store := s
			if i%2 == 0 {
				store = other
			}
			var e error
			states[i], e = store.Complete(data)
			if e != nil {
				t.Error(e)
			}
		}(i)
	}
	wg.Wait()
	for _, state := range states {
		if !reflect.DeepEqual(state, states[0]) {
			t.Fatal("states differ")
		}
	}
	out, err := s.Export()
	if err != nil || len(out["completions"].([]map[string]any)) != 1 {
		t.Fatalf("%v %v", out, err)
	}
}
