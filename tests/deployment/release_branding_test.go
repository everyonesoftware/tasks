package deployment

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestTasksReleasePackagingKeepsUpdaterIdentity(t *testing.T) {
	root := t.TempDir()
	apk := filepath.Join(root, "input.apk")
	if err := os.WriteFile(apk, []byte("fixture APK bytes, not an installable release"), 0600); err != nil {
		t.Fatal(err)
	}
	aapt := filepath.Join(root, "fixture-aapt")
	fixture := "#!/bin/sh\nprintf \"package: name='com.everyonesoftware.daymark' versionCode='137' versionName='137'\\nminSdkVersion:'26'\\n\"\n"
	if err := os.WriteFile(aapt, []byte(fixture), 0700); err != nil {
		t.Fatal(err)
	}
	out := filepath.Join(root, "out")
	cmd := exec.Command("python3", "../../scripts/create_android_release.py", "--apk", apk, "--out", out, "--aapt", aapt)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("existing release helper: %v: %s", err, output)
	}
	data, err := os.ReadFile(filepath.Join(out, "daymark-release.json"))
	if err != nil {
		t.Fatal("must retain updater metadata asset for existing installs:", err)
	}
	var manifest struct {
		ApkAssetName string
		PackageName  string
		VersionName  string
		VersionCode  int
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.ApkAssetName != "Tasks-137-137.apk" || manifest.PackageName != "com.everyonesoftware.daymark" || manifest.VersionName != "137" || manifest.VersionCode != 137 {
		t.Fatalf("wrong brand or lost compatibility: %+v", manifest)
	}
	if _, err := os.Stat(filepath.Join(out, manifest.ApkAssetName)); err != nil {
		t.Fatal(err)
	}
}
