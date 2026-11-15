package deployment

import (
	"strings"
	"testing"
)

func TestTasksContainerAndArtifactsKeepDeploymentIdentity(t *testing.T) {
	dockerfile := rootFile(t, "Dockerfile")
	for _, required := range []string{"COPY cmd/tasks/ ./cmd/tasks/", "-o /out/tasks ./cmd/tasks", "COPY --from=build /out/tasks /app/tasks", `ENTRYPOINT ["/app/tasks"]`, "org.opencontainers.image.title=\"Tasks\"", "USER 10001:10001"} {
		if !strings.Contains(dockerfile, required) {
			t.Errorf("container missing %q", required)
		}
	}
	compose := rootFile(t, "docker-compose.yml")
	for _, required := range []string{"tasks-data:/data", "/data/daymark.sqlite3", "DAYMARK_HOST"} {
		if !strings.Contains(compose, required) {
			t.Errorf("deployment compatibility missing %q", required)
		}
	}
	workflow := rootFile(t, ".github/workflows/publish.yml")
	for _, required := range []string{"name: Publish Tasks", "dist/android/Tasks-$DAYMARK_VERSION.apk", "name: Tasks-android-"} {
		if !strings.Contains(workflow, required) {
			t.Errorf("build branding missing %q", required)
		}
	}
}
