package server

import (
	"encoding/json"
	"os"
	"testing"
)

func TestHealthReportsBuildVersion(t *testing.T) {
	want := os.Getenv("DAYMARK_EXPECT_VERSION")
	if want == "" {
		want = "dev"
	}
	_, handler := newHTTPFixture(t, Config{})
	response := httpRequest(t, handler, "GET", "/health", "", "")
	var health struct {
		Status  string `json:"status"`
		Version string `json:"version"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &health) != nil {
		t.Fatalf("invalid health response: %d %s", response.Code, response.Body)
	}
	if health.Status != "ok" || health.Version != want {
		t.Fatalf("health = %+v, want status ok and version %s", health, want)
	}
}
