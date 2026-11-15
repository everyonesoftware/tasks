package deployment

import (
	"strings"
	"testing"
)

func TestPublishWorkflowUsesOneCommitCountForBothDeliverables(t *testing.T) {
	workflow := rootFile(t, ".github/workflows/publish.yml")
	for _, required := range []string{
		"branches: [main]", "workflow_dispatch:", "fetch-depth: 0",
		"bash scripts/build-version.sh", "packages: write",
		`bash scripts/container-tags.sh "$DAYMARK_VERSION" "$GITHUB_SHA"`,
		"tags: ${{ steps.tags.outputs.tags }}", "VERSION=${{ needs.validate.outputs.version }}",
		"DAYMARK_VERSION: ${{ needs.validate.outputs.version }}",
		"secrets.GITHUB_TOKEN", "secrets.DAYMARK_KEYSTORE_BASE64",
		"secrets.DAYMARK_KEYSTORE_PASSWORD", "secrets.DAYMARK_KEY_ALIAS", "secrets.DAYMARK_KEY_PASSWORD",
		":app:assembleRelease", `apksigner" verify`, `aapt2" dump badging`,
		"if-no-files-found: error", "if: always()", "rm -f", "cancel-in-progress: false",
	} {
		if !strings.Contains(workflow, required) {
			t.Errorf("workflow missing %q", required)
		}
	}
	for _, forbidden := range []string{"pull_request_target:", "gh release create", "signing/daymark-release.p12", "run_number", "run: echo ${{ secrets."} {
		if strings.Contains(workflow, forbidden) {
			t.Errorf("unsafe/incorrect workflow contains %q", forbidden)
		}
	}
	dockerfile := rootFile(t, "Dockerfile")
	for _, required := range []string{"ARG VERSION=dev", "-X github.com/everyonesoftware/tasks/services/server.Version=${VERSION}", "org.opencontainers.image.version=", "org.opencontainers.image.source="} {
		if !strings.Contains(dockerfile, required) {
			t.Errorf("Dockerfile missing %q", required)
		}
	}
}
