package deployment

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func rootFile(t *testing.T, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", name))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestDockerBuildsStandaloneNonRootGoRuntime(t *testing.T) {
	dockerfile := rootFile(t, "Dockerfile")
	for _, required := range []string{
		"FROM golang:1.26.11-bookworm AS build",
		"CGO_ENABLED=0", "go build", "./cmd/tasks",
		"FROM debian:bookworm-slim", "COPY --from=build /out/tasks /app/tasks",
		"COPY apps/web/ ./apps/web/", "USER 10001:10001",
		"chown 10001:10001 /data", "chmod 0700 /data",
		`ENTRYPOINT ["/app/tasks"]`,
	} {
		if !strings.Contains(dockerfile, required) {
			t.Errorf("Dockerfile missing %q", required)
		}
	}
	if strings.Contains(strings.ToLower(dockerfile), "python") {
		t.Error("Docker image must not depend on Python")
	}
	if strings.Contains(dockerfile, "COPY . ") {
		t.Error("Do not copy repository/secrets wholesale")
	}
}

func TestDockerImageProvidesDefaultHealthcheck(t *testing.T) {
	dockerfile := rootFile(t, "Dockerfile")
	for _, required := range []string{
		"HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3",
		`CMD ["/app/tasks", "healthcheck", "--url", "http://127.0.0.1:8787/health"]`,
	} {
		if !strings.Contains(dockerfile, required) {
			t.Errorf("Dockerfile missing %q", required)
		}
	}
}

func TestComposeKeepsSecureDeploymentSettings(t *testing.T) {
	config := rootFile(t, "docker-compose.yml")
	for _, required := range []string{
		"read_only: true", "ALL", "no-new-privileges:true",
		"tasks-data:/data", "127.0.0.1:${DAYMARK_PORT:-8787}:8787",
		"/data/daymark.sqlite3", "--allow-insecure-http", "--public-origin",
		"${DAYMARK_HOST:?", "  tasks-data:",
	} {
		if !strings.Contains(config, required) {
			t.Errorf("Compose missing %q", required)
		}
	}
	for _, forbidden := range []string{"--tls-cert", "--tls-key", "/certs", "DAYMARK_BIND_IP", "python", "--insecure", "container_name:"} {
		if strings.Contains(config, forbidden) {
			t.Errorf("Compose must not contain %q", forbidden)
		}
	}
}

func TestRenderedComposeSecurePersistentDeployment(t *testing.T) {
	command := []string{"docker", "compose"}
	if binary := os.Getenv("COMPOSE_BINARY"); binary != "" {
		command = []string{binary}
	}
	if _, err := exec.LookPath(command[0]); err != nil {
		t.Skip("Compose not installed")
	}
	version := exec.Command(command[0], append(command[1:], "version")...)
	if output, err := version.CombinedOutput(); err != nil {
		if os.Getenv("COMPOSE_BINARY") != "" {
			t.Fatalf("Compose version: %v: %s", err, output)
		}
		t.Skipf("Docker Compose plugin unavailable: %s", output)
	}
	cmd := exec.Command(command[0], append(command[1:], "-f", "docker-compose.yml", "config", "--format", "json")...)
	cmd.Dir = filepath.Join("..", "..")
	cmd.Env = append(os.Environ(), "DAYMARK_HOST=tasks.example.test", "DAYMARK_PORT=9443")
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("Compose config: %v", err)
	}
	var config struct {
		Services map[string]struct {
			ReadOnly    bool `json:"read_only"`
			Command     []string
			CapDrop     []string `json:"cap_drop"`
			SecurityOpt []string `json:"security_opt"`
			Ports       []struct {
				HostIP    string `json:"host_ip"`
				Published string
				Target    int
			}
			Volumes []struct {
				Type, Source, Target string
			}
		}
		Volumes map[string]json.RawMessage
	}
	if err := json.Unmarshal(output, &config); err != nil {
		t.Fatal(err)
	}
	service, ok := config.Services["tasks"]
	if !ok {
		t.Fatal("tasks service missing")
	}
	if !service.ReadOnly {
		t.Error("root filesystem must be read-only")
	}

	if strings.Join(service.CapDrop, ",") != "ALL" || strings.Join(service.SecurityOpt, ",") != "no-new-privileges:true" {
		t.Error("container hardening must be preserved")
	}
	wantCommand := "serve --host 0.0.0.0 --port 8787 --db /data/daymark.sqlite3 --allowed-host tasks.example.test --public-origin https://tasks.example.test --allow-insecure-http"
	if got := strings.Join(service.Command, " "); got != wantCommand {
		t.Errorf("command = %q, want %q", got, wantCommand)
	}
	if len(service.Ports) != 1 || service.Ports[0].HostIP != "127.0.0.1" || service.Ports[0].Published != "9443" || service.Ports[0].Target != 8787 {
		t.Errorf("HTTP backend must publish only to loopback: %+v", service.Ports)
	}
	mounts := make(map[string]string)
	for _, mount := range service.Volumes {
		mounts[mount.Target] = mount.Source

		if mount.Target == "/data" && mount.Type != "volume" {
			t.Error("database must use existing named volume")
		}
	}
	if len(mounts) != 1 || mounts["/data"] != "tasks-data" {
		t.Errorf("unexpected mounts: %v", mounts)
	}
	if _, ok := config.Volumes["tasks-data"]; !ok {
		t.Error("tasks-data volume identity changed")
	}
}
