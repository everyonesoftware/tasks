package deployment

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Product names may change; Android upgrade and encrypted-session identities may not.
func TestAndroidTasksBrandingPreservesUpgradeIdentity(t *testing.T) {
	for path, required := range map[string][]string{
		"apps/android/settings.gradle.kts":                                               {`rootProject.name = "Tasks"`},
		"apps/android/app/src/main/AndroidManifest.xml":                                  {`android:label="Tasks"`, `android:icon="@mipmap/ic_tasks"`, `android:roundIcon="@mipmap/ic_tasks"`},
		"apps/android/app/build.gradle.kts":                                              {`namespace = "com.everyonesoftware.daymark"`, `applicationId = "com.everyonesoftware.daymark"`, `"DAYMARK_KEYSTORE_PATH"`, `"DAYMARK_KEYSTORE_PASSWORD"`, `"DAYMARK_KEY_ALIAS"`, `"DAYMARK_KEY_PASSWORD"`},
		"apps/android/app/src/main/java/com/everyonesoftware/daymark/AndroidSecurity.kt": {`getSharedPreferences("daymark",Context.MODE_PRIVATE)`, `"daymark-session-v2"`},
		"apps/android/app/src/main/java/com/everyonesoftware/daymark/SettingsScreen.kt":  {`fun TasksApp(`, `Text("Tasks",`},
		"apps/android/app/src/main/java/com/everyonesoftware/daymark/MainActivity.kt":    {`class TasksViewModel(`, `File(updateDir,"Tasks.apk")`, `TasksTheme {TasksApp(`},
		"apps/android/app/src/main/java/com/everyonesoftware/daymark/Data.kt":            {`class TasksRepository(`},
		"apps/android/app/src/main/java/com/everyonesoftware/daymark/Updater.kt":         {`.header("User-Agent","Tasks-Android")`, `asset(if(hasTasksManifest) "tasks-release.json" else "daymark-release.json")`, `File(dir,"Tasks.apk")`},
	} {
		contents := rootFile(t, path)
		for _, text := range required {
			if !strings.Contains(contents, text) {
				t.Errorf("%s: missing %q", path, text)
			}
		}
	}
	root := filepath.Join("..", "..", "apps", "android", "app", "src")
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		if strings.Contains(entry.Name(), "Daymark") || entry.Name() == "ic_daymark.xml" {
			t.Errorf("old product source filename: %s", path)
		}
		if filepath.Ext(path) != ".kt" {
			return nil
		}
		contents, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		// Package paths and persistent keys deliberately retain daymark.
		if strings.Contains(string(contents), "Daymark") {
			t.Errorf("old product branding or symbol in %s", path)
		}
		if strings.Contains(string(contents), `Text("daymark"`) {
			t.Errorf("old visible wordmark in %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		"main/java/com/everyonesoftware/daymark/TasksScreen.kt",
		"androidTest/java/com/everyonesoftware/daymark/TasksScreenTest.kt",
		"main/res/drawable/ic_tasks.xml",
	} {
		if _, err := os.Stat(filepath.Join(root, path)); err != nil {
			t.Error(err)
		}
	}
}
