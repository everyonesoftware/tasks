# Deploy Tasks (Daymark) with Docker Compose

Run commands from the repository root. This setup builds the Go API binary and
web client into one image and serves them over **direct HTTPS** on port 8787.
Android connects to the same HTTPS origin. It does not include Android builds or
publish an image/release.

## 1. Configure HTTPS

Install Docker Engine with the Docker Compose v2 plugin on the deployment host.
Obtain a TLS certificate trusted by your browser and Android device, matching the
hostname you will use. Certificate issuance/renewal and DNS are managed separately.
Do not disable client certificate verification.

Create a local `.env` file (already excluded from Git) with your actual values:

```dotenv
DAYMARK_HOST=tasks.example.com
DAYMARK_PORT=8787
DAYMARK_CERT_DIR=/absolute/path/to/daymark-certs
# Optional: bind only to a specific host interface instead of all IPv4 interfaces.
# DAYMARK_BIND_IP=127.0.0.1
```

The certificate directory must already exist and contain `fullchain.pem` and
`privkey.pem`. It is mounted read-only and is not included in the image. The
container runs as UID/GID **10001:10001**: give that identity read access to the
certificate/key and traversal access to their directory, without making the
private key world-readable. For example, on a normal rootful Linux Docker host,
a dedicated certificate directory can be owned by root, grouped to GID 10001,
with directory mode 0750, key mode 0640, and certificate mode 0644. Rootless/user
namespace deployments may need different host-side UID/GID mappings.

Certificate symlinks must resolve inside the mounted directory. Do not mount only
an ACME `live` directory whose links point to an unmounted `archive` directory;
use a dedicated directory with actual certificate/key files or an enclosing
certificate tree. Keep keys outside `apps/web` and outside Git. Restart the
service after replacing renewed certificates so it reloads them:

```sh
docker compose restart tasks
```

For Dan's tailnet hostname, set `DAYMARK_HOST=hermesdan.tail1a7c8f.ts.net` and use a
trusted certificate for that exact hostname. The default resulting address is
`https://hermesdan.tail1a7c8f.ts.net:8787/`. This file does not provision Tailscale,
certificates, DNS, firewall rules, or public Internet access.

## 2. Build, provision, and start

```sh
docker compose config --quiet
docker compose build --pull
docker compose run --rm --no-deps tasks create-user --db /data/daymark.sqlite3 --username dan
docker compose up -d
docker compose ps
docker compose logs --tail=50 tasks
```

The account command asks for the password twice at a hidden terminal prompt; no
password goes into `.env` or command-line arguments. No default accounts or tasks
are created. Open `https://YOUR_HOST:8787/` (or your configured port), then sign in.
Permit the chosen port only on the intended networks using the host firewall.
Do not add `--allow-insecure-http` to make a deployment start.

Reset a password (also revokes that account's existing sessions):

```sh
docker compose run --rm --no-deps tasks reset-password --db /data/daymark.sqlite3 --username dan
```

## Persistence, backups, and updates

The named `tasks-data` volume and `/data/daymark.sqlite3` path are unchanged from the Python deployment. Before replacing an existing server, stop writes and take a full SQLite backup; do not run old and new servers concurrently against one database. Test migrations against a disposable backup first. No tasks are seeded and legacy ownership is never silently adopted.

The named `tasks-data` volume stores `/data/daymark.sqlite3`, including accounts,
sessions, tasks and history. **This is a new database, not an automatic migration
of a host `.data/daymark.sqlite3`.** An existing database needs a deliberate backup
and transfer into this volume with ownership suitable for UID 10001. Keep the
same Compose project name/directory to reuse the same project-scoped volume.

`docker compose down` preserves the database volume. **Do not use
`docker compose down -v` unless you intend to delete it.** Use SQLite's backup API
for live backups, or stop the service before safely copying its database. Protect
backups as private data; per-user `/api/export` is not a full database backup.

After updating the checkout, rebuild and recreate the service:

```sh
docker compose build --pull
docker compose up -d
```

The health check runs `/app/daymark healthcheck --ca /certs/fullchain.pem --connect-address 127.0.0.1:8787`.
Its default URL is `https://$DAYMARK_HOST:8787/health`, independent of the published
`DAYMARK_PORT`. The probe dials the container's loopback port 8787 while retaining
`DAYMARK_HOST` for TLS SNI, certificate hostname verification, and the HTTP Host
header. It validates TLS trust and `/health` without requiring container DNS or
hairpin routing to the published address. It does not prove an account exists or that external DNS/firewall
access works. Check your actual external HTTPS address from your client too.
The root filesystem is read-only; the database volume is writable. A multi-stage Go 1.26.11 build uses `CGO_ENABLED=0`; the non-root Debian slim runtime
contains `/app/daymark`, `/app/apps/web`, and CA certificates, not Python or the Go
toolchain. The build context must allow `go.mod`, `go.sum`, `cmd/daymark`, Go
server sources, and web assets, but not the database, Android artifacts, repository
metadata, or secrets.

The server deliberately rejects ordinary non-loopback HTTP, even when
`--public-origin` is set. A separate proxy container forwarding plain HTTP over a
Docker bridge is therefore **not** supported by this configuration. Direct TLS
avoids weakening that guard.

## Configuration checks

```sh
go test ./tests/deployment -v
go test ./...
go vet ./...
docker compose config --quiet
docker build -t daymark:local .
```

The Go deployment tests check image/configuration invariants. When Compose is
installed, the rendered configuration test uses `docker compose config` and does not require a running
Docker daemon. Set `COMPOSE_BINARY` to use a standalone Compose v2 executable.
