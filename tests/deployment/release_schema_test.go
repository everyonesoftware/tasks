package deployment

import (
	"encoding/json"
	"regexp"
	"testing"
)

func TestTasksReleaseSchemaAcceptsCommitCountsAndLegacyAssets(t *testing.T) {
	var schema struct {
		Title      string
		Properties map[string]struct {
			Const   any
			Pattern string
		}
	}
	if err := json.Unmarshal([]byte(rootFile(t, "contracts/android-release.schema.json")), &schema); err != nil {
		t.Fatal(err)
	}
	if schema.Title != "Tasks Android release manifest" {
		t.Errorf("wrong schema brand: %s", schema.Title)
	}
	if schema.Properties["packageName"].Const != "com.everyonesoftware.daymark" {
		t.Error("rebrand must retain installed app identity")
	}
	for field, values := range map[string][]string{"versionName": {"137", "0.2.0"}, "apkAssetName": {"Tasks-137-137.apk", "Daymark-0.2.0-2.apk"}} {
		pattern := regexp.MustCompile(schema.Properties[field].Pattern)
		for _, value := range values {
			if !pattern.MatchString(value) {
				t.Errorf("%s rejects compatible %q", field, value)
			}
		}
		if pattern.MatchString("../../outside") {
			t.Errorf("%s accepts unsafe path", field)
		}
	}
}
