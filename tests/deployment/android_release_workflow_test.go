package deployment

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Execute the actual workflow shell rather than a second implementation of it.
func workflowRun(t *testing.T, name string) string {
	t.Helper()
	workflow := rootFile(t, ".github/workflows/publish.yml")
	_, step, ok := strings.Cut(workflow, "      - name: "+name+"\n")
	if !ok {
		t.Fatalf("workflow step %q missing", name)
	}
	step, _, _ = strings.Cut(step, "\n      - ")
	_, run, ok := strings.Cut(step, "        run: |\n")
	if !ok {
		t.Fatalf("workflow step %q has no shell", name)
	}
	var lines []string
	for line := range strings.SplitSeq(run, "\n") {
		if strings.TrimSpace(line) != "" && !strings.HasPrefix(line, "          ") {
			break // A final run step ends at the next job, not only the next step.
		}
		lines = append(lines, strings.TrimPrefix(line, "          "))
	}
	return strings.Join(lines, "\n")
}

func TestAndroidWorkflowStagesUpdaterManifestFromVerifiedAPK(t *testing.T) {
	for _, sdkKey := range []string{"minSdkVersion", "sdkVersion"} {
		t.Run(sdkKey, func(t *testing.T) {
			dir := t.TempDir()
			write := func(name, content string, mode os.FileMode) {
				t.Helper()
				path := filepath.Join(dir, name)
				if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte(content), mode); err != nil {
					t.Fatal(err)
				}
			}
			// Only the SDK inspection boundary is stubbed; no real APK is published.
			write("apps/android/app/build/outputs/apk/release/app-release.apk", "fixture APK bytes", 0600)
			write("sdk/build-tools/36.0.0/apksigner", "#!/bin/sh\nexit 0\n", 0700)
			write("sdk/build-tools/36.0.0/aapt2", "#!/bin/sh\nprintf \"package: name='com.everyonesoftware.daymark' versionCode='137' versionName='137'\\n"+sdkKey+":'26'\\n\"\n", 0700)
			cmd := exec.Command("bash", "-euo", "pipefail", "-c", workflowRun(t, "Verify and stage APK"))
			cmd.Dir = dir
			cmd.Env = append(os.Environ(), "ANDROID_HOME="+filepath.Join(dir, "sdk"), "DAYMARK_VERSION=137", "GITHUB_SHA="+strings.Repeat("a", 40), "GITHUB_STEP_SUMMARY="+filepath.Join(dir, "summary"))
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("stage: %v: %s", err, output)
			}
			data, err := os.ReadFile(filepath.Join(dir, "dist/android/daymark-release.json"))
			if err != nil {
				t.Fatalf("updater manifest missing: %v", err)
			}
			var manifest struct {
				SchemaVersion int
				PackageName   string
				VersionName   string
				VersionCode   int
				MinSdk        int
				ApkAssetName  string
				Sha256        string
			}
			if err := json.Unmarshal(data, &manifest); err != nil {
				t.Fatal(err)
			}
			apk, err := os.ReadFile(filepath.Join(dir, "dist/android", manifest.ApkAssetName))
			if err != nil {
				t.Fatal(err)
			}
			digest := sha256.Sum256(apk)
			if manifest.SchemaVersion != 1 || manifest.PackageName != "com.everyonesoftware.daymark" || manifest.VersionName != "137" || manifest.VersionCode != 137 || manifest.MinSdk != 26 || manifest.ApkAssetName != "Tasks-137.apk" || manifest.Sha256 != hex.EncodeToString(digest[:]) || string(apk) != "fixture APK bytes" {
				t.Fatalf("incorrect manifest or APK: %+v", manifest)
			}
		})
	}
}
