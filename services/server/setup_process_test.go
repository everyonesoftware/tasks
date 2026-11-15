package server

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// A real subprocess exercises SQLite locking without sharing Store/pool locks.
func TestSetupProcessHelper(t *testing.T) {
	path := os.Getenv("TASKS_FIXTURE_SETUP_DB")
	if path == "" {
		return
	}
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	fmt.Println("ready")
	if _, err = io.ReadFull(os.Stdin, make([]byte, 1)); err != nil {
		t.Fatal(err)
	}
	_, err = s.CompleteSetup(os.Getenv("TASKS_FIXTURE_SETUP_KEY"), "First", "fixture-password")
	if err == nil {
		fmt.Println("created")
		return
	}
	var api *APIError
	if errors.As(err, &api) && api.Status == 409 {
		fmt.Println("conflict")
		return
	}
	t.Fatal(err)
}

func TestSetupParallelProcessesHaveSingleWinner(t *testing.T) {
	s := openFixture(t)
	key, _, err := s.GenerateSetupKey()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	type child struct {
		cmd    *exec.Cmd
		in     io.WriteCloser
		out    *bufio.Reader
		stderr strings.Builder
	}
	children := make([]*child, 4)
	for i := range children {
		c := &child{cmd: exec.CommandContext(ctx, os.Args[0], "-test.run=^TestSetupProcessHelper$")}
		c.cmd.Env = append(os.Environ(), "TASKS_FIXTURE_SETUP_DB="+s.Path, "TASKS_FIXTURE_SETUP_KEY="+key)
		c.in, err = c.cmd.StdinPipe()
		if err != nil {
			t.Fatal(err)
		}
		stdout, err := c.cmd.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		c.out = bufio.NewReader(stdout)
		c.cmd.Stderr = &c.stderr
		if err = c.cmd.Start(); err != nil {
			t.Fatal(err)
		}
		children[i] = c
		line, err := c.out.ReadString('\n')
		if err != nil || line != "ready\n" {
			t.Fatalf("child readiness %q %v", line, err)
		}
	}
	for _, c := range children {
		if _, err = io.WriteString(c.in, "x"); err != nil {
			t.Fatal(err)
		}
		c.in.Close()
	}
	winners := 0
	for _, c := range children {
		line, err := c.out.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		switch line {
		case "created\n":
			winners++
		case "conflict\n":
		default:
			t.Fatalf("unexpected child outcome %q", line)
		}
		// Drain the Go testing success line before waiting for process completion.
		if _, err = io.Copy(io.Discard, c.out); err != nil {
			t.Fatal(err)
		}
		if err = c.cmd.Wait(); err != nil {
			t.Fatalf("child failed: %v %s", err, &c.stderr)
		}
	}
	if winners != 1 {
		t.Fatalf("process winners=%d", winners)
	}
	setupCounts(t, s, 1, 1, 0)
}
