# Deploy Tasks with Docker Compose

Run commands from the repository root. Compose pulls the published
`ghcr.io/everyonesoftware/tasks:latest` image containing the Go API and web client,
with an HTTP backend published **only on host loopback**.
Tailscale Serve on the same host supplies HTTPS for web and Android clients.
No certificate files or TLS settings are needed in the container. The Tasks
rebrand preserves database paths and other legacy configuration names; the
hostname variable is now `TASKS_HOST`. See
[Rebranding and compatibility](rebranding.md).

## 1. Configure the hostname

Install Docker Engine, Docker Compose v2, and Tailscale on the deployment host.
Create a local `.env` file (already excluded from Git):

```dotenv
TASKS_HOST=hermesdan.tail1a7c8f.ts.net
# Optional local backend port; this is NOT the public HTTPS port.
# DAYMARK_PORT=8787
```

Use the actual Tailscale HTTPS hostname of the Docker host, without a scheme,
path, or port. Old `DAYMARK_CERT_DIR` and `DAYMARK_BIND_IP` settings are no longer
used. The public origin is `https://$TASKS_HOST` on standard HTTPS port 443.
Rename an existing `DAYMARK_HOST` entry to `TASKS_HOST`; the old name is no longer
read. This sets the server's public HTTPS origin for Secure cookies and browser
Origin/Referer validation, not its bind address or backend port. It does not
configure DNS, certificates, or Tailscale Serve itself.

## 2. Pull, start, and set up your first account

```sh
docker compose config --quiet
docker compose pull
docker compose up -d
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
docker compose ps
docker compose logs --tail=50 tasks
```

If you changed `DAYMARK_PORT`, use that local port in the Serve command. Follow
any Tailscale prompt to enable HTTPS/Serve for your tailnet. For a new database,
generate a one-time setup key from an operator terminal:

```sh
docker compose exec tasks tasks setup-key --db /data/daymark.sqlite3
```

Open `https://YOUR_TAILSCALE_HOST/`. The **All in one** welcome form asks for the
setup key and your chosen username/password. Select **Create account & start**
to enter the empty workspace. No default accounts or sample tasks are created.
The key is shown only by the explicit administrator command, not in normal
server logs. Treat it as a secret: do not paste it into chat, a URL, `.env` or a
log file. It expires in 30 minutes; running the command again invalidates the
previous key. Once an account exists, setup/key generation are disabled and the
browser shows sign-in instead. These commands require a build containing the
first-run setup feature; an older image with no `setup-key` command must be
updated before using browser setup.

To skip browser setup or provision another account:

```sh
docker compose run --rm --no-deps tasks create-user --db /data/daymark.sqlite3 --username dan
```

That command asks for the password twice at a hidden terminal prompt; no password
goes into `.env` or command-line arguments. See the official
[Tailscale Serve reference](https://tailscale.com/kb/1242/tailscale-serve).

The image's `docker-entrypoint.sh` supplies the normal server arguments; Compose
only passes `TASKS_HOST`. Explicit commands such as `setup-key` or `create-user` still override
normal startup and do not require the hostname when invoking the image directly.
The entrypoint uses the existing `--allow-insecure-http` opt-in for the
local Docker bridge hop; `--public-origin` keeps session cookies Secure and browser
writes restricted to the HTTPS origin. Do not expose the backend port on all
interfaces, forward it publicly, or use this setup without the HTTPS proxy.
Tailscale network access does not replace Tasks account authentication. The
server's development-mode HTTP warning is expected with this explicit opt-in.
All proxied clients share the backend's socket-peer login rate-limit bucket.
The minimal Compose file leaves capabilities, privilege options and logging at
Docker's defaults. The non-root image, read-only root filesystem, loopback-only
published port and application authentication remain. Configure log rotation
in the Docker daemon if you need it.

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

Pull the latest published image and recreate the service:

```sh
docker compose pull
docker compose up -d
```

The image supplies `/app/tasks healthcheck --url http://127.0.0.1:8787/health`.
It checks the container's HTTP backend independently of the published port and
Tailscale. It does not prove HTTPS, external reachability, or account access;
check your actual Tailscale HTTPS address from a client too.
The root filesystem is read-only; the database volume is writable. A multi-stage Go 1.26.11 build uses `CGO_ENABLED=0`; the non-root Debian slim runtime
contains `/app/tasks`, `/app/apps/web`, and CA certificates, not Python or the Go
toolchain. The build context must allow `go.mod`, `go.sum`, `cmd/tasks`, Go
server sources, and web assets, but not the database, Android artifacts, repository
metadata, or secrets.

For a standalone deployment without Tailscale Serve, configure direct TLS using
the server's `--tls-cert` / `--tls-key` flags and replace the image's HTTP health
check with a TLS-verifying probe. Do not reuse this HTTP Compose setup as an
Internet-facing deployment.

## Configuration checks

```sh
go test ./tests/deployment -v
go test ./...
go vet ./...
docker compose config --quiet
docker build -t tasks:local .
```

The Go deployment tests check image/configuration invariants. When Compose is
installed, the rendered configuration test uses `docker compose config` and does not require a running
Docker daemon. Set `COMPOSE_BINARY` to use a standalone Compose v2 executable.
