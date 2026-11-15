package deployment

import (
	"strings"
	"testing"
)

func TestDockerContextIncludesGoBuildInputsAndExcludesPrivateData(t *testing.T) {
	ignore := rootFile(t, ".dockerignore")
	for _, rule := range []string{"**", "!go.mod", "!go.sum", "!cmd/", "!cmd/tasks/", "!cmd/tasks/*.go", "!services/server/*.go", "!apps/web/**", "**/.*"} {
		found := false
		for _, line := range strings.Split(ignore, "\n") {
			if line == rule {
				found = true
			}
		}
		if !found {
			t.Errorf("Docker context missing rule %q", rule)
		}
	}
	if strings.Contains(ignore, "!services/server/*.py") {
		t.Error("Python server still included in image context")
	}
}
