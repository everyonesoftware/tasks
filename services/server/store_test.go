package server

import (
	"database/sql"
	"path/filepath"
	"reflect"
	"testing"
)

func scopedFixture(t *testing.T) (*Store, *Store) {
	t.Helper()
	s := openFixture(t)
	id, err := s.CreateUser("Fixture", "fixture-password")
	if err != nil {
		t.Fatal(err)
	}
	scoped, err := s.ForUser(id)
	if err != nil {
		t.Fatal(err)
	}
	return s, scoped
}
func createFixtureTask(t *testing.T, s *Store, fields map[string]any) map[string]any {
	t.Helper()
	data := map[string]any{"title": "Task", "startDate": "2026-11-14"}
	for k, v := range fields {
		data[k] = v
	}
	v, err := s.Create(data)
	if err != nil {
		t.Fatal(err)
	}
	return v
}
func TestTaskLifecycleOwnerIsolation(t *testing.T) {
	root, a := scopedFixture(t)
	uid, err := root.CreateUser("Other", "fixture-password")
	if err != nil {
		t.Fatal(err)
	}
	b, err := root.ForUser(uid)
	if err != nil {
		t.Fatal(err)
	}
	_, err = root.Create(map[string]any{})
	wantStatus(t, err, 401)
	_, err = root.Export()
	wantStatus(t, err, 401)
	_, err = root.ForUser("missing")
	wantStatus(t, err, 401)
	task := createFixtureTask(t, a, map[string]any{"title": "  Robert'); DROP TABLE tasks;--  "})
	id := task["id"].(string)
	if len(id) != 36 || task["title"] != "Robert'); DROP TABLE tasks;--" || task["ownerId"] != nil {
		t.Fatal(task)
	}
	empty, err := b.Export()
	if err != nil || len(empty["tasks"].([]map[string]any)) != 0 {
		t.Fatalf("%v %v", empty, err)
	}
	data := map[string]any{"title": "Edited", "startDate": "2026-11-16"}
	_, err = b.Update(id, data)
	wantStatus(t, err, 404)
	wantStatus(t, b.Archive(id), 404)
	edited, err := a.Update(id, data)
	if err != nil || edited["id"] != id || edited["createdAt"] != task["createdAt"] {
		t.Fatalf("%v %v", edited, err)
	}
	reopened, err := Open(root.Path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	a2, err := reopened.ForUser(a.owner)
	if err != nil {
		t.Fatal(err)
	}
	out, err := a2.Export()
	if err != nil {
		t.Fatal(err)
	}
	row := out["tasks"].([]map[string]any)[0]
	if row["title"] != "Edited" || row["archived"] != 0 {
		t.Fatal(out)
	}
	if err = a.Archive(id); err != nil {
		t.Fatal(err)
	}
	_, err = a.Update(id, data)
	wantStatus(t, err, 404)
	wantStatus(t, a.Archive("missing"), 404)
	out, err = a.Export()
	if err != nil || out["tasks"].([]map[string]any)[0]["archived"] != 1 {
		t.Fatalf("%v %v", out, err)
	}
}
func TestLegacyMigrationExplicitAdoption(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.sqlite3")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,notes TEXT NOT NULL,category TEXT NOT NULL,repeat TEXT NOT NULL,interval INTEGER NOT NULL,startDate TEXT NOT NULL,priority INTEGER NOT NULL,createdAt TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE completions(taskId TEXT NOT NULL REFERENCES tasks(id),dueDate TEXT NOT NULL,completedOn TEXT NOT NULL,completedAt TEXT NOT NULL,PRIMARY KEY(taskId,dueDate));
 INSERT INTO tasks VALUES('legacy','Old','','Personal','once',1,'2026-11-14',0,'2026-11-14T00:00:00Z',1);
 INSERT INTO completions VALUES('legacy','2026-11-14','2026-11-14','2026-11-14T01:00:00Z');`)
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	uid, err := s.CreateUser("Alice", "fixture-password")
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.ForUser(uid)
	if err != nil {
		t.Fatal(err)
	}
	out, err := a.Export()
	if err != nil || !reflect.DeepEqual(out["tasks"], []map[string]any{}) {
		t.Fatalf("silently adopted: %v %v", out, err)
	}
	_, err = s.AdoptLegacy("missing")
	wantStatus(t, err, 404)
	n, err := s.AdoptLegacy("ALICE")
	if err != nil || n != 1 {
		t.Fatalf("%d %v", n, err)
	}
	n, err = s.AdoptLegacy("alice")
	if err != nil || n != 0 {
		t.Fatalf("%d %v", n, err)
	}
	out, err = a.Export()
	if err != nil || len(out["completions"].([]map[string]any)) != 1 || out["tasks"].([]map[string]any)[0]["archived"] != 1 {
		t.Fatalf("%v %v", out, err)
	}
}
