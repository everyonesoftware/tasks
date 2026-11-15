package deployment

import (
	"regexp"
	"strings"
	"testing"
)

func TestAndroidVersionUsesValidatedCommitCount(t *testing.T) {
	config := rootFile(t, "apps/android/app/build.gradle.kts")
	for _, required := range []string{
		`val daymarkVersion = providers.environmentVariable("DAYMARK_VERSION").orNull ?: run {`,
		`commandLine("git", "rev-parse", "--is-shallow-repository")`,
		`require(shallow == "false")`,
		`commandLine("git", "rev-list", "--count", "HEAD")`,
		`daymarkVersion.toIntOrNull()?.takeIf`,
		`daymarkVersion.matches(Regex("[1-9][0-9]*"))`,
		`it <= 2100000000`,
		`versionCode = daymarkVersionCode`,
		`versionName = daymarkVersion`,
	} {
		if !strings.Contains(config, required) {
			t.Errorf("Android version configuration missing %q", required)
		}
	}
	if regexp.MustCompile(`versionCode\s*=\s*\d|versionName\s*=\s*"`).MatchString(config) {
		t.Error("Android versions must not be hardcoded")
	}
	shallowCheck := strings.Index(config, `require(shallow == "false")`)
	count := strings.Index(config, `commandLine("git", "rev-list", "--count", "HEAD")`)
	if shallowCheck < 0 || count < 0 || shallowCheck > count {
		t.Error("Local builds must reject shallow history before counting commits")
	}
}
