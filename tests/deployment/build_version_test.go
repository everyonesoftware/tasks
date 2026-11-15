package deployment

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildVersionCountsFullHistoryAndRejectsShallowClones(t *testing.T) {
	script, err := filepath.Abs("../../scripts/build-version.sh")
	if err != nil {
		t.Fatal(err)
	}
	repo := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.test", "GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.test")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
	}
	git("init", "-b", "main")
	git("commit", "--allow-empty", "-m", "one")
	git("commit", "--allow-empty", "-m", "two")
	git("switch", "-c", "side")
	git("commit", "--allow-empty", "-m", "side")
	git("switch", "main")
	git("commit", "--allow-empty", "-m", "main")
	git("merge", "--no-ff", "side", "-m", "merge")
	cmd := exec.Command("bash", script)
	cmd.Dir = repo
	output, err := cmd.CombinedOutput()
	if err != nil || strings.TrimSpace(string(output)) != "5" {
		t.Fatalf("version = %q, %v; want 5 including merged history", output, err)
	}
	clone := filepath.Join(t.TempDir(), "shallow")
	git("clone", "--depth=1", "file://"+repo, clone)
	cmd = exec.Command("bash", script)
	cmd.Dir = clone
	if output, err := cmd.CombinedOutput(); err == nil || !strings.Contains(string(output), "shallow") {
		t.Fatalf("must reject shallow history: %q, %v", output, err)
	}
}
