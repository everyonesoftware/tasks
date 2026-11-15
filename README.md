# Tasks

A personal task app for web and native Android, using the approved **Focus + queue** design: one Current task, a daily progress bar, and a queue of what is still due.

Tasks is the new product name for Daymark, not a new installation identity. Existing databases, Android app ID/signing identity, sessions and `DAYMARK_*` configuration names stay unchanged; see [Rebranding and compatibility](docs/rebranding.md).

## Scope

- One-time, daily, weekly, monthly, and yearly tasks, including every-N intervals.
- Anchored schedules, including month-end and leap-day behavior.
- Current task, top-right three-dot menu (**Not now**), bottom-right **Mark done**, queue picking, and completion undo.
- Today, Upcoming, Routines, and Settings; create/edit/archive tasks.
- Authenticated server accounts with private, per-user tasks and completion history.
- First-install Android setup asks for server URL, username, and password. Settings reviews/tests/updates that connection and signs out.
- Android Settings shows installed version/build and checks actual stable GitHub releases. Downloaded updates require digest/package/version/signer verification and the user's Android installation confirmation.

## Server-only task data

Task records and history are persisted only in the server's SQLite database. Clients keep task state in memory while connected, not in a persistent local task cache. When disconnected, sign back in/reconnect to access or change tasks. Failed writes are never presented as completed. The client removes legacy task caches from the earlier v0.1 prototype.

Android stores only connection details and a platform-protected session token, never the password. The browser uses an HttpOnly session cookie rather than storing a token in localStorage. Sign-out clears local account state; if the server cannot be reached, remote session revocation cannot be confirmed.

A new database has no sample tasks and no default username or password. Server administrators provision accounts separately; the Android app does not create an account by submitting arbitrary credentials.

## Run and provision the server

Go 1.26.11+; SQLite uses the pure-Go `modernc.org/sqlite` driver. No Python runtime, CGO, or system SQLite library is required. Build from the repository root:

```sh
CGO_ENABLED=0 go build -o bin/tasks ./cmd/tasks
```

The examples below use that binary; `go run ./cmd/tasks` accepts the same subcommands and flags for development.

From this directory, provision an account in the persistent server database:

```sh
./bin/tasks create-user --db .data/daymark.sqlite3 --username dan
```

Enter the password directly at the hidden terminal prompt. Do not put passwords in chat, command-line literals, source files, or Git. Automation/tests can use `--password-stdin` with an appropriate secret source. Account provisioning, resetting passwords, or adopting legacy unowned tasks is an explicit administrator operation; see `services/server/README.md` for exact options.

### HTTPS deployment

For a container deployment with persistent storage and Tailscale-provided HTTPS, use the root
`docker-compose.yml` and follow **[Docker deployment](docs/docker-deployment.md)**
for Tailscale Serve setup, account provisioning, startup, and backups.

Use a certificate trusted by the clients, either directly:

```sh
./bin/tasks serve --host 0.0.0.0 --port 8787 \
  --db .data/daymark.sqlite3 \
  --tls-cert /path/to/fullchain.pem --tls-key /path/to/private-key.pem
```

or behind a separately configured HTTPS reverse proxy, with the explicit external `--public-origin` as documented by the server. Do not blindly forward/accept arbitrary proxy-origin headers. Do not disable Android TLS/certificate validation to make a connection succeed.

For a certificate matching Dan's hostname, the direct HTTPS address would be:

```text
https://hermesdan.tail1a7c8f.ts.net:8787/
```

This is a deployment target, not a claim that a trusted certificate or reverse proxy has already been installed on this host. Container port publishing/firewall/Tailscale access must allow the chosen port.

### Local development

```sh
./bin/tasks serve --host 127.0.0.1 --port 8787 --db .data/daymark.sqlite3
```

HTTP sign-in is allowed on loopback for development. A separate `--allow-insecure-http` option explicitly permits the existing encrypted-tailnet development setup; it is not suitable for plain/public Internet credential transport. Native release builds default to HTTPS. Any debug-only tailnet HTTP exception is visibly warned about, not silently enabled.

The server serves only `apps/web`, never the repository root, credentials, database, mockups, or source tree. Authentication is not a substitute for TLS, firewall rules, backups, and secure deployment.

## Android builds

The native Kotlin/Compose client lives in `apps/android`; it is not a WebView. Install the app, enter your server origin and provisioned account, and sign in. The device must be able to reach that server (including joining the appropriate tailnet if applicable).

On this build host:

```sh
source /opt/data/tools/android-env.sh
cd apps/android
bash gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug --console=plain --max-workers=2
```

Release builds use an explicitly configured persistent signing identity. See **docs/android-releases.md** for the protected key location, signing environment variables, actual-APK manifest packaging, and the release asset convention. Do not lose or publish the private signing key.

The updater reads actual releases from `everyonesoftware/tasks`; a new release must include the signed APK and `daymark-release.json`. No release is fabricated or automatically published. A downloaded package or installer intent is not proof of a completed installation; the installed PackageManager version is authoritative.

## Backups and operational limits

- Persist `.data/daymark.sqlite3` across container recreation, for example in a persistent Docker volume. It contains task records, account password hashes, and session hashes; protect it accordingly.
- Authenticated `GET /api/export` exports only the signed-in user's task/history data, not credential/session tables. Import/restore is not exposed in the UI.
- For a complete live database backup, use SQLite's backup API rather than copying only one file during writes. Back up TLS and Android signing credentials separately and securely.
- Dates are calendar-local: clients send their current local date. Devices in different time zones may therefore show different days around midnight.
- No collaboration, task sharing, push reminders, widgets, alarms, or offline write queue are included in this version.

## Development

- `apps/web/`: dependency-free responsive browser UI.
- `apps/android/`: native Android application.
- `cmd/tasks/`: Go CLI and server entry point.
- `services/server/`: Go authentication, HTTP API, scheduling, SQLite.
- `contracts/api.md`: task API and recurrence semantics.
- `contracts/auth-and-updates.md`: authoritative authenticated connection and updater behavior; supersedes the old no-auth/cache assumptions.
- `contracts/android-release.schema.json`: GitHub release manifest format.
- `scripts/create_android_release.py`: package actual APK bytes and metadata; does not upload/sign/publish.
- `mockups/`: historical design artifacts, not production UI.

Verification commands:

```sh
go test ./...
go vet ./...
python3 -m unittest discover -s tests/release -v
node --test tests/web/*.test.mjs
```

Actual execution results and any unverified deployment/device behavior belong in `docs/verification.md`, not in assumed success claims. No source commits, pushes, or GitHub releases are created without separate authorization.
