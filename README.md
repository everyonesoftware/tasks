# Tasks

<!-- current-downloads:start -->
## Current downloads

Each platform keeps its newest verified manifest-backed publication; versions may differ.

| Platform | Version | Download | Status |
| --- | --- | --- | --- |
| Windows x64 | 0.1.35 | [Installer (.exe)](https://github.com/everyonesoftware/tasks/releases/download/v35/TasksWindows-win-x64-Setup.exe) · [SHA-256](https://github.com/everyonesoftware/tasks/releases/download/v35/TasksWindows-win-x64-Setup.exe.sha256) | Unsigned; Windows may show an unknown-publisher/SmartScreen warning. |
| Android | 29 | [APK](https://github.com/everyonesoftware/tasks/releases/download/v29/Tasks-29.apk) · [SHA-256](https://github.com/everyonesoftware/tasks/releases/download/v29/SHA256SUMS) | Signed with the Tasks release key. |
| Web / server | — | [Deployment documentation](https://github.com/everyonesoftware/tasks/blob/main/docs/docker-deployment.md) | Self-hosted together; no standalone web installer. |

Verify SHA-256 checksums before installation. Unchanged platforms retain their original release, version and source identity. This table is not an in-app update feed.
<!-- current-downloads:end -->

A personal task app for web, native Android, and a native Windows client in development, using the approved **Focus + queue** design: one Current task, a daily progress bar, and a queue of what is still due.

Tasks is the new product name for Daymark, not a new installation identity. Existing databases, Android app ID/signing identity, sessions and `DAYMARK_*` configuration names stay unchanged; see [Rebranding and compatibility](docs/rebranding.md).

The download tables refresh automatically from verified platform publications; see [download discovery and release-note automation](docs/CURRENT-DOWNLOADS.md).

## Scope

- One-time, daily, weekly, monthly, and yearly tasks, including every-N intervals.
- Anchored schedules, including month-end and leap-day behavior.
- Current task, top-right three-dot menu (**Not now**), bottom-right **Mark done**, queue picking, and completion undo.
- Today, Upcoming, Routines, and Settings; create/edit/archive tasks.
- Authenticated server accounts with private, per-user tasks and completion history.
- First-run web welcome creates the first account using one form and an operator-issued one-time setup key. Later visits restore your session or show sign-in.
- First-install Android setup asks for server URL, username, and password. Settings reviews/tests/updates that connection and signs out.
- Android Settings shows installed version/build and checks actual stable GitHub releases. Downloaded updates require digest/package/version/signer verification and the user's Android installation confirmation.

## Server-only task data

Task records and history are persisted only in the server's SQLite database. Clients keep task state in memory while connected, not in a persistent local task cache. When disconnected, sign back in/reconnect to access or change tasks. Failed writes are never presented as completed. The client removes legacy task caches from the earlier v0.1 prototype.

Android stores only connection details and a platform-protected session token, never the password. The browser uses an HttpOnly session cookie rather than storing a token in localStorage. Sign-out clears local account state; if the server cannot be reached, remote session revocation cannot be confirmed.

A new database has no sample tasks and no default username or password. The first account can be created in the web welcome screen with a one-time setup key from the server operator. Additional accounts are provisioned by the administrator CLI; the Android app does not create an account by submitting arbitrary credentials.

## Run and provision the server

Go 1.26.11+; SQLite uses the pure-Go `modernc.org/sqlite` driver. No Python runtime, CGO, or system SQLite library is required. Build from the repository root:

```sh
CGO_ENABLED=0 go build -o bin/tasks ./cmd/tasks
```

The examples below use that binary; `go run ./cmd/tasks` accepts the same subcommands and flags for development.

For the **All in one** browser setup, start the server using the transport instructions below and find `Setup key:` in its startup logs. To replace an expired key without restarting, generate a key against that same database:

```sh
./bin/tasks setup-key --db .data/daymark.sqlite3
```

Open the server in your browser, paste the key into **Setup key**, choose a username/password, and select **Create account & start**. The key expires after 30 minutes; restarting an unconfigured server or running the command again replaces it. Keep server logs private and keys out of chat, URLs, shared log exports and source files. Once an account exists, startup emits no key and the command refuses. A successful setup signs you in to an empty workspace with **Add your first task**.

Alternatively, create the first account directly, or add later accounts, from this directory:

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

The updater reads actual releases from `everyonesoftware/tasks`; a new Android release must include the signed APK, primary `tasks-release.json` and a byte-identical `daymark-release.json` alias for installed legacy clients. New clients prefer the Tasks name and support legacy-only historical releases. No release is fabricated; the authorized main-branch workflow publishes verified builds. A downloaded package or installer intent is not proof of a completed installation; the installed PackageManager version is authoritative.

## Native Windows development

The selected **Familiar** direction is implemented as a C#/WinUI 3 client in `apps/windows`, not a WebView. The first slice covers existing-account sign-in, protected session storage, Today/focus/queue, completion/undo, task creation, read-only Upcoming/Routines, and connection settings. The publishing workflow builds an unsigned per-user Windows installer, gates it on native install/launch/uninstall acceptance, and attaches it beside the APK in the same `vN` release. See [Windows build and acceptance](apps/windows/README.md) and [CI publishing](docs/ci-publishing.md) for commands and validation limits. The newly added installer workflow has not run until these changes are pushed; no Windows update feed is implemented.

## Backups and operational limits

- Persist `.data/daymark.sqlite3` across container recreation, for example in a persistent Docker volume. It contains task records, account password hashes, and session hashes; protect it accordingly.
- Authenticated `GET /api/export` exports only the signed-in user's task/history data, not credential/session tables. Import/restore is not exposed in the UI.
- For a complete live database backup, use SQLite's backup API rather than copying only one file during writes. Back up TLS and Android signing credentials separately and securely.
- Dates are calendar-local: clients send their current local date. Devices in different time zones may therefore show different days around midnight.
- No collaboration, task sharing, push reminders, widgets, alarms, or offline write queue are included in this version.

## Development

- `apps/web/`: dependency-free responsive browser UI.
- `apps/android/`: native Android application.
- `apps/windows/`: native C#/WinUI application and platform-independent authenticated client core, in development.
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
