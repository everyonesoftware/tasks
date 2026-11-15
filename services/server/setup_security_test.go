package server

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"testing"
)

func setupCounts(t *testing.T, s *Store, users, sessions, keys int) {
	t.Helper()
	for _, tc := range []struct {
		table string
		want  int
	}{{"users", users}, {"sessions", sessions}, {"setup_state", keys}} {
		var got int
		if err := s.db.QueryRow("SELECT COUNT(*) FROM " + tc.table).Scan(&got); err != nil || got != tc.want {
			t.Fatalf("%s count=%d want=%d err=%v", tc.table, got, tc.want, err)
		}
	}
}

func TestSetupRejectsMissingRotatedExpiredAndInvalidKeys(t *testing.T) {
	s := openFixture(t)
	_, err := s.CompleteSetup(strings.Repeat("a", 43), "First", "fixture-password")
	wantStatus(t, err, 401)
	old, _, err := s.GenerateSetupKey()
	if err != nil {
		t.Fatal(err)
	}
	key, _, err := s.GenerateSetupKey()
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{old, "", "é", key + "=", strings.Repeat("a", 257), "\xff", key[:42]} {
		_, err = s.CompleteSetup(bad, "First", "fixture-password")
		wantStatus(t, err, 401)
		setupCounts(t, s, 0, 0, 1)
	}
	for _, expiry := range []string{"2000-01-01T00:00:00Z", "invalid"} {
		if _, err = s.db.Exec("UPDATE setup_state SET expiresAt=?", expiry); err != nil {
			t.Fatal(err)
		}
		_, err = s.CompleteSetup(key, "First", "fixture-password")
		wantStatus(t, err, 401)
		setupCounts(t, s, 0, 0, 1)
	}
	key, _, err = s.GenerateSetupKey()
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(s.Path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if _, err = reopened.CompleteSetup(key, "First", "fixture-password"); err != nil {
		t.Fatal(err)
	}
	setupCounts(t, s, 1, 1, 0)
}

func TestSetupValidationPreservesKey(t *testing.T) {
	s := openFixture(t)
	key, _, err := s.GenerateSetupKey()
	if err != nil {
		t.Fatal(err)
	}
	for _, account := range [][2]string{{"é", "fixture-password"}, {"bad name", "fixture-password"}, {"", "fixture-password"}, {strings.Repeat("u", 65), "fixture-password"}, {"First", "short"}, {"First", strings.Repeat("p", 1025)}, {"First", "password\xff"}} {
		_, err = s.CompleteSetup(key, account[0], account[1])
		wantStatus(t, err, 400)
		setupCounts(t, s, 0, 0, 1)
	}
	if _, err = s.CompleteSetup(key, "First", "🔒🔒🔒🔒🔒🔒🔒🔒"); err != nil {
		t.Fatal(err)
	}
}

func TestSetupDatabaseFailureRollsBackEveryWrite(t *testing.T) {
	for _, point := range []struct{ name, trigger string }{
		{"user", `CREATE TRIGGER fail_setup BEFORE INSERT ON users BEGIN SELECT RAISE(ABORT,'fixture failure'); END`},
		{"session", `CREATE TRIGGER fail_setup BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'fixture failure'); END`},
		{"consume", `CREATE TRIGGER fail_setup BEFORE DELETE ON setup_state BEGIN SELECT RAISE(ABORT,'fixture failure'); END`},
	} {
		t.Run(point.name, func(t *testing.T) {
			s := openFixture(t)
			key, _, err := s.GenerateSetupKey()
			if err != nil {
				t.Fatal(err)
			}
			if _, err = s.db.Exec(point.trigger); err != nil {
				t.Fatal(err)
			}
			login, err := s.CompleteSetup(key, "First", "fixture-password")
			if err == nil || login != nil {
				t.Fatal("failed transaction returned success")
			}
			setupCounts(t, s, 0, 0, 1)
			if _, err = s.db.Exec("DROP TRIGGER fail_setup"); err != nil {
				t.Fatal(err)
			}
			if _, err = s.CompleteSetup(key, "First", "fixture-password"); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSetupParallelIndependentStoresHaveSingleWinner(t *testing.T) {
	s := openFixture(t)
	key, _, err := s.GenerateSetupKey()
	if err != nil {
		t.Fatal(err)
	}
	const n = 8
	stores := make([]*Store, n)
	for i := range stores {
		stores[i], err = Open(s.Path)
		if err != nil {
			t.Fatal(err)
		}
		defer stores[i].Close()
	}
	start := make(chan struct{})
	results := make(chan error, n)
	for _, store := range stores {
		go func(s *Store) { <-start; _, err := s.CompleteSetup(key, "First", "fixture-password"); results <- err }(store)
	}
	close(start)
	successes := 0
	for range n {
		err = <-results
		if err == nil {
			successes++
		} else {
			wantStatus(t, err, 409)
		}
	}
	if successes != 1 {
		t.Fatalf("winners=%d", successes)
	}
	setupCounts(t, s, 1, 1, 0)
}

func TestSetupCannotBecomeSecondAccountAfterConcurrentCLIWrite(t *testing.T) {
	s := openFixture(t)
	key, _, err := s.GenerateSetupKey()
	if err != nil {
		t.Fatal(err)
	}
	other, err := Open(s.Path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	// Hold a separate connection's actual SQLite writer lock, just as a CLI
	// process does, then enqueue browser setup before committing the first user.
	ready, release := make(chan struct{}), make(chan struct{})
	var wg sync.WaitGroup
	wg.Go(func() {
		err := s.write(func(c *sql.Conn) error {
			_, err := c.ExecContext(context.Background(), "INSERT INTO users VALUES(?,?,?,?,?)", "fixture-id", "CLI", []byte("salt"), []byte("hash"), iterations)
			if err != nil {
				return err
			}
			close(ready)
			<-release
			return nil
		})
		if err != nil {
			t.Error(err)
		}
	})
	<-ready
	result := make(chan error, 1)
	go func() { _, err := other.CompleteSetup(key, "Browser", "fixture-password"); result <- err }()
	close(release)
	wg.Wait()
	wantStatus(t, <-result, 409)
	setupCounts(t, s, 1, 0, 1)
	// The real CLI entry point also leaves browser setup disabled.
	_, err = other.CompleteSetup(key, "Browser", "fixture-password")
	wantStatus(t, err, 409)
}

func TestSetupRaceWithRealCreateUser(t *testing.T) {
	for range 4 {
		s := openFixture(t)
		key, _, err := s.GenerateSetupKey()
		if err != nil {
			t.Fatal(err)
		}
		other, err := Open(s.Path)
		if err != nil {
			t.Fatal(err)
		}
		start := make(chan struct{})
		cli := make(chan error, 1)
		browser := make(chan error, 1)
		go func() { <-start; _, err := s.CreateUser("CLI", "fixture-password"); cli <- err }()
		go func() { <-start; _, err := other.CompleteSetup(key, "Browser", "fixture-password"); browser <- err }()
		close(start)
		if err = <-cli; err != nil {
			t.Fatal(err)
		}
		err = <-browser
		if err != nil {
			wantStatus(t, err, 409)
			setupCounts(t, s, 1, 0, 1)
		} else {
			setupCounts(t, s, 2, 1, 0)
		}
		// A successful browser account must precede the CLI account. The CLI is
		// explicitly allowed to add subsequent users; browser setup never is.
		var api *APIError
		if err != nil && (!errors.As(err, &api) || api.Status != 409) {
			t.Fatal(err)
		}
		other.Close()
	}
}
