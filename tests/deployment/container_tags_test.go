package deployment

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestContainerTagsOnlyPromoteCurrentMainHead(t *testing.T) {
	script, err := filepath.Abs("../../scripts/container-tags.sh")
	if err != nil {
		t.Fatal(err)
	}
	repo := t.TempDir()
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.test", "GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.test")
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
		return strings.TrimSpace(string(output))
	}
	git("init", "-b", "main")
	git("commit", "--allow-empty", "-m", "old")
	old := git("rev-parse", "HEAD")
	git("commit", "--allow-empty", "-m", "current")
	current := git("rev-parse", "HEAD")
	git("remote", "add", "origin", repo)
	for _, tc := range []struct{ version, sha, want string }{
		{"1", old, "ghcr.io/everyonesoftware/tasks:1\n"},
		{"2", current, "ghcr.io/everyonesoftware/tasks:2\nghcr.io/everyonesoftware/tasks:latest\n"},
	} {
		cmd := exec.Command("bash", script, tc.version, tc.sha)
		cmd.Dir = repo
		output, err := cmd.CombinedOutput()
		if err != nil || string(output) != tc.want {
			t.Errorf("tags for %s = %q, %v; want %q", tc.sha, output, err, tc.want)
		}
	}
	git("remote", "set-url", "origin", filepath.Join(repo, "missing"))
	cmd := exec.Command("bash", script, "2", current)
	cmd.Dir = repo
	if output, err := cmd.Output(); err == nil || len(output) != 0 {
		t.Fatalf("remote lookup must fail closed: %q, %v", output, err)
	}
}
