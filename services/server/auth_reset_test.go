package server

import (
	"sync"
	"testing"
)

func TestPasswordResetRevokesAndRacesLogin(t *testing.T) {
	s := openFixture(t)
	_, err := s.CreateUser("Alice", "old-fixture-password")
	if err != nil {
		t.Fatal(err)
	}
	login, err := s.Login("alice", "old-fixture-password")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.ResetPassword("ALICE", "new-fixture-password"); err != nil {
		t.Fatal(err)
	}
	_, err = s.Session(login["token"].(string))
	wantStatus(t, err, 401)
	_, err = s.Login("Alice", "old-fixture-password")
	wantStatus(t, err, 401)
	if _, err = s.Login("Alice", "new-fixture-password"); err != nil {
		t.Fatal(err)
	}
	if err = s.ResetPassword("missing", "new-fixture-password"); err == nil {
		t.Fatal("missing user")
	}
	wantStatus(t, s.ResetPassword("Alice", "bad"), 400)
	// Concurrent issuance cannot survive a reset that invalidates its verified
	// credential version, whether hashing finishes before or after that reset.
	var wg sync.WaitGroup
	start := make(chan struct{})
	var mu sync.Mutex
	tokens := []string{}
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if v, e := s.Login("Alice", "new-fixture-password"); e == nil {
				mu.Lock()
				tokens = append(tokens, v["token"].(string))
				mu.Unlock()
			} else {
				var status int
				if a, ok := e.(*APIError); ok {
					status = a.Status
				}
				if status != 401 {
					t.Error(e)
				}
			}
		}()
	}
	close(start)
	if err = s.ResetPassword("Alice", "final-fixture-password"); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	for _, token := range tokens {
		_, err = s.Session(token)
		wantStatus(t, err, 401)
	}
	var count int
	if err = s.db.QueryRow("SELECT COUNT(*) FROM sessions").Scan(&count); err != nil || count != 0 {
		t.Fatalf("stale sessions %d %v", count, err)
	}
}
