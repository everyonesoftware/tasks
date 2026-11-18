package deployment

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// runAndroidReleaseWorkflow executes the real workflow shell with local-only Git/GH boundaries.
// A successful fake create switches subsequent tag lookups to the post-create state.
func runAndroidReleaseWorkflow(t *testing.T, run, remote, failure, before, after string, platforms ...string) (string, error, string, string, string) {
	t.Helper()
	dir := t.TempDir()
	for name, content := range map[string]string{
		"git": `#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "$GIT_CALLS"
case "$*" in
  'ls-remote --exit-code origin refs/heads/main')
    [[ -n $REMOTE ]] || exit 1
    printf '%s\trefs/heads/main\n' "$REMOTE"
    ;;
  'ls-remote origin refs/tags/v137 refs/tags/v137^{}')
    if [[ -f $CREATED ]]; then
      [[ $FAILURE != tag-after ]] || exit 1
      printf '%s' "$TAG_AFTER"
    else
      [[ $FAILURE != tag-before ]] || exit 1
      printf '%s' "$TAG_BEFORE"
    fi
    ;;
  *) exit 2 ;;
esac
`,
		"gh": `#!/bin/bash
set -euo pipefail
printf '%s\n' "$*" >> "$CALLS"
[[ $2 != "$FAILURE" ]] || exit 1
case "$1 $2" in
  'release create') touch "$CREATED" ;;
  'release view')
    printf 'Tasks-137.apk\nSHA256SUMS\n'
    [[ $FAILURE == missing-primary-manifest ]] || echo tasks-release.json
    [[ $FAILURE == missing ]] || echo daymark-release.json
    [[ $FAILURE == missing-windows-installer ]] || echo Tasks-Windows-137-Setup.exe
    [[ $FAILURE == missing-windows-checksum ]] || echo Tasks-Windows-137-Setup.exe.sha256
    [[ $FAILURE == missing-velopack-setup ]] || echo TasksWindows-win-x64-Setup.exe
    [[ $FAILURE == missing-velopack-checksum ]] || echo TasksWindows-win-x64-Setup.exe.sha256
    [[ $FAILURE == missing-velopack-feed ]] || echo releases.win-x64.json
    [[ $FAILURE == missing-velopack-package ]] || echo TasksWindows-0.1.137-win-x64-full.nupkg
    ;;
  *) exit 2 ;;
esac
exit 0
`,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0700); err != nil {
			t.Fatal(err)
		}
	}
	calls, gitCalls, summary := filepath.Join(dir, "calls"), filepath.Join(dir, "git-calls"), filepath.Join(dir, "summary")
	cmd := exec.Command("bash", "-euo", "pipefail", "-c", run)
	cmd.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"), "REMOTE="+remote, "FAILURE="+failure, "CALLS="+calls, "GIT_CALLS="+gitCalls, "CREATED="+filepath.Join(dir, "created"), "TAG_BEFORE="+before, "TAG_AFTER="+after, "DAYMARK_VERSION=137", "GITHUB_SHA="+strings.Repeat("a", 40), "GITHUB_REPOSITORY=fixture/tasks", "GITHUB_STEP_SUMMARY="+summary)
	android, windows := "true", "true"
	if len(platforms) == 2 {
		android, windows = platforms[0], platforms[1]
	}
	cmd.Env = append(cmd.Env, "BUILD_ANDROID="+android, "BUILD_WINDOWS="+windows)
	output, err := cmd.CombinedOutput()
	read := func(path string) string {
		data, readErr := os.ReadFile(path)
		if readErr != nil && !os.IsNotExist(readErr) {
			t.Fatal(readErr)
		}
		return string(data)
	}
	return string(output), err, read(calls), read(gitCalls), read(summary)
}

func TestSelectivePlatformReleasePreservesUnchangedOutputs(t *testing.T) {
	sha := strings.Repeat("a", 40)
	run := workflowRun(t, "Publish GitHub release")
	for _, tc := range []struct {
		name, android, windows, required, absent, latest string
	}{
		{"Windows only", "false", "true", "dist/windows/releases.win-x64.json", "dist/android/Tasks-137.apk", "false"},
		{"Android only", "true", "false", "dist/android/Tasks-137.apk", "dist/windows/releases.win-x64.json", "true"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			output, err, calls, _, _ := runAndroidReleaseWorkflow(t, run, sha, "", "", sha+"\trefs/tags/v137\n", tc.android, tc.windows)
			if err != nil {
				t.Fatalf("selective publish failed: %v: %s", err, output)
			}
			if !strings.Contains(calls, tc.required) || strings.Contains(calls, tc.absent) || !strings.Contains(calls, "--latest="+tc.latest) {
				t.Fatalf("wrong selective publication: %s", calls)
			}
		})
	}
}

func TestAndroidReleasePublishesAndVerifiesBothManifestNames(t *testing.T) {
	sha := strings.Repeat("a", 40)
	run := workflowRun(t, "Publish GitHub release")
	for _, failure := range []string{"", "missing-primary-manifest", "missing"} {
		t.Run("readback-"+failure, func(t *testing.T) {
			output, err, calls, _, summary := runAndroidReleaseWorkflow(t, run, sha, failure, "", sha+"\trefs/tags/v137\n", "true", "false")
			if (err != nil) != (failure != "") {
				t.Errorf("publish error = %v, want error %v: %s", err, failure != "", output)
			}
			create, _, _ := strings.Cut(calls, "\n")
			for _, name := range []string{"tasks-release.json", "daymark-release.json"} {
				if !strings.Contains(create, "dist/android/"+name) {
					t.Errorf("release upload missing %s: %s", name, create)
				}
			}
			if failure != "" && strings.Contains(summary, "Published") {
				t.Error("must not claim publication when either manifest is missing from readback")
			}
		})
	}
}

func TestAndroidWorkflowReleaseTagIdentity(t *testing.T) {
	sha, other, object := strings.Repeat("a", 40), strings.Repeat("b", 40), strings.Repeat("c", 40)
	lightweight := sha + "\trefs/tags/v137\n"
	wrong := other + "\trefs/tags/v137\n"
	annotated := object + "\trefs/tags/v137\n" + sha + "\trefs/tags/v137^{}\n"
	// The tag object's SHA matches the build, but its peeled commit does not.
	wrongAnnotated := lightweight + other + "	refs/tags/v137^{}\n"
	run := workflowRun(t, "Publish GitHub release")
	for _, tc := range []struct {
		name, before, after, failure string
		wantError, wantCreate        bool
	}{
		{"mismatched lightweight tag", wrong, lightweight, "", true, false},
		{"mismatched annotated tag", wrongAnnotated, lightweight, "", true, false},
		{"matching annotated tag", annotated, annotated, "", false, true},
		{"matching lightweight tag", lightweight, lightweight, "", false, true},
		{"missing tag before creation", "", lightweight, "", false, true},
		{"missing post-create tag", "", "", "", true, true},
		{"wrong post-create tag", "", wrong, "", true, true},
		{"wrong post-create annotated tag", "", wrongAnnotated, "", true, true},
		{"tag lookup failure before creation", lightweight, lightweight, "tag-before", true, false},
		{"tag lookup failure after creation", "", lightweight, "tag-after", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			output, err, calls, gitCalls, summary := runAndroidReleaseWorkflow(t, run, sha, tc.failure, tc.before, tc.after)
			if (err != nil) != tc.wantError {
				t.Errorf("publish error = %v, want error %v: %s", err, tc.wantError, output)
			}
			if created := strings.Contains(calls, "release create v137"); created != tc.wantCreate {
				t.Errorf("release created = %v, want %v: %s", created, tc.wantCreate, calls)
			}
			if tc.wantError && strings.Contains(summary, "Published") {
				t.Errorf("must not claim publication after tag verification failure: %s", summary)
			}
			wantLookups := 1
			if tc.wantCreate {
				wantLookups = 2
			}
			if got := strings.Count(gitCalls, "ls-remote origin refs/tags/v137 refs/tags/v137^{}\n"); got != wantLookups {
				t.Errorf("tag lookups = %d, want %d: %s", got, wantLookups, gitCalls)
			}
		})
	}
}

func TestAndroidWorkflowPublishesReleaseAfterVerifiedArtifact(t *testing.T) {
	workflow := rootFile(t, ".github/workflows/publish.yml")
	_, release, ok := strings.Cut(workflow, "  release:\n")
	if !ok || !strings.Contains(release, "    permissions:\n      contents: write\n") {
		t.Fatal("combined publisher needs job-scoped contents: write")
	}
	if strings.Count(workflow, "contents: write") != 1 || strings.Contains(strings.Split(workflow, "jobs:")[0], "contents: write") {
		t.Fatal("only the release job may write repository contents")
	}
	if !strings.Contains(release, "    needs: [validate, android, windows]\n") || strings.Contains(release, "if: always()") {
		t.Fatal("release must require successful validation and both platform jobs")
	}
	if !strings.Contains(release, "GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}") {
		t.Fatal("release step must authenticate with the workflow token")
	}
	run := workflowRun(t, "Publish GitHub release")
	for _, tc := range []struct {
		name, remote, failure, wantLatest string
		wantError                         bool
	}{
		{"current main", strings.Repeat("a", 40), "", "true", false},
		{"old rerun", strings.Repeat("b", 40), "", "false", false},
		{"remote unavailable", "", "", "", true},
		{"create fails or release exists", strings.Repeat("a", 40), "create", "true", true},
		{"readback fails", strings.Repeat("a", 40), "view", "true", true},
		{"missing asset", strings.Repeat("a", 40), "missing", "true", true},
		{"missing Windows installer", strings.Repeat("a", 40), "missing-windows-installer", "true", true},
		{"missing Windows checksum", strings.Repeat("a", 40), "missing-windows-checksum", "true", true},
		{"missing Velopack setup", strings.Repeat("a", 40), "missing-velopack-setup", "true", true},
		{"missing Velopack checksum", strings.Repeat("a", 40), "missing-velopack-checksum", "true", true},
		{"missing Velopack feed", strings.Repeat("a", 40), "missing-velopack-feed", "true", true},
		{"missing Velopack package", strings.Repeat("a", 40), "missing-velopack-package", "true", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			output, err, log, _, _ := runAndroidReleaseWorkflow(t, run, tc.remote, tc.failure, "", strings.Repeat("a", 40)+"	refs/tags/v137\n")
			if (err != nil) != tc.wantError {
				t.Fatalf("publish error = %v, want error %v: %s", err, tc.wantError, output)
			}
			if tc.remote == "" {
				if log != "" {
					t.Fatalf("remote failure must prevent publishing: %s", log)
				}
				return
			}
			for _, required := range []string{"release create v137", "--repo fixture/tasks", "--target " + strings.Repeat("a", 40), "--title Tasks 137", "--generate-notes", "--draft=false", "--prerelease=false", "--latest=" + tc.wantLatest, "dist/android/Tasks-137.apk", "dist/android/SHA256SUMS", "dist/android/daymark-release.json", "dist/windows/Tasks-Windows-137-Setup.exe", "dist/windows/Tasks-Windows-137-Setup.exe.sha256", "dist/windows/TasksWindows-win-x64-Setup.exe", "dist/windows/TasksWindows-win-x64-Setup.exe.sha256", "dist/windows/releases.win-x64.json", "dist/windows/TasksWindows-0.1.137-win-x64-full.nupkg"} {
				if !strings.Contains(log, required) {
					t.Errorf("release command missing %q: %s", required, log)
				}
			}
			if tc.failure == "create" && strings.Contains(log, "release view") {
				t.Fatal("must not claim success after creation failure")
			}
			if !tc.wantError && !strings.Contains(log, "release view v137") {
				t.Fatal("must read back the exact published release")
			}
		})
	}
}
