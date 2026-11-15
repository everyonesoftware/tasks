package deployment

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
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

func TestComposeUsesGoHealthcheckAndKeepsVolumeIdentity(t *testing.T) {
	config := rootFile(t, "docker-compose.yml")
	for _, required := range []string{
		"        - /app/tasks\n        - healthcheck\n        - --ca\n        - /certs/fullchain.pem\n        - --connect-address\n        - 127.0.0.1:8787",
		"    read_only: true", "      - ALL", "      - no-new-privileges:true",
		"        source: tasks-data", "        target: /data", "        target: /certs",
		"        read_only: true", "          create_host_path: false",
		"      - /data/daymark.sqlite3", "      - /certs/privkey.pem", "      - /certs/fullchain.pem",
		"      DAYMARK_HOST:", "  tasks-data:",
	} {
		if !strings.Contains(config, required) {
			t.Errorf("Compose missing %q", required)
		}
	}
	for _, forbidden := range []string{"--allow-insecure-http", "python", "--insecure", "container_name:"} {
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
	cmd.Env = append(os.Environ(), "DAYMARK_HOST=tasks.example.test", "DAYMARK_PORT=9443", "DAYMARK_CERT_DIR=/fixture/certs")
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("Compose config: %v", err)
	}
	var config struct {
		Services map[string]struct {
			ReadOnly    bool `json:"read_only"`
			Command     []string
			Environment map[string]string
			Healthcheck struct{ Test []string }
			Volumes     []struct {
				Type, Source, Target string
				ReadOnly             bool `json:"read_only"`
				Bind                 struct {
					CreateHostPath bool `json:"create_host_path"`
				}
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
	want := []string{"CMD", "/app/tasks", "healthcheck", "--ca", "/certs/fullchain.pem", "--connect-address", "127.0.0.1:8787"}
	if !reflect.DeepEqual(service.Healthcheck.Test, want) {
		t.Errorf("healthcheck = %q, want %q", service.Healthcheck.Test, want)
	}
	if service.Environment["DAYMARK_HOST"] != "tasks.example.test" {
		t.Error("DAYMARK_HOST not passed to healthcheck")
	}
	if !strings.Contains(strings.Join(service.Command, " "), "--public-origin https://tasks.example.test:9443") {
		t.Error("public origin must honor published port")
	}
	mounts := make(map[string]string)
	for _, mount := range service.Volumes {
		mounts[mount.Target] = mount.Source
		if mount.Target == "/certs" && (!mount.ReadOnly || mount.Bind.CreateHostPath) {
			t.Error("certificate bind must be read-only, never auto-created")
		}
		if mount.Target == "/data" && mount.Type != "volume" {
			t.Error("database must use existing named volume")
		}
	}
	if len(mounts) != 2 || mounts["/data"] != "tasks-data" || mounts["/certs"] != "/fixture/certs" {
		t.Errorf("unexpected mounts: %v", mounts)
	}
	if _, ok := config.Volumes["tasks-data"]; !ok {
		t.Error("tasks-data volume identity changed")
	}
}
