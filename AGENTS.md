# Tasks working rules

One cohesive product: web, native Android, native Windows, and a private single-user server. No commits or pushes without Dan's authorization.

## Ownership
- `apps/web`: responsive HTML/CSS/JS client; relative same-origin `/api` calls.
- `apps/android`: Kotlin/Compose client; configurable server base URL.
- `apps/windows`: C#/WinUI Familiar client; authenticated API core and Windows-protected session envelope. See its scoped instructions and README for native versus compile-only gates.
- `cmd/tasks`: Go CLI; `services/server`: Go HTTP API, recurrence engine, and pure-Go SQLite (`modernc.org/sqlite`).
- `contracts/auth-and-updates.md`: authoritative authentication, server-only-data, connection and Android updater requirements. It supersedes old no-auth/cache assumptions in `contracts/api.md`; task JSON shapes stay compatible.
- `mockups`: historical design artifacts, not production source.

## Checks
- Write a failing behavior test before each production behavior slice, verify RED, implement, verify GREEN.
- Backend/deployment: `go test ./...` and `go vet ./...` (Go 1.26.11+). Build: `CGO_ENABLED=0 go build -o bin/tasks ./cmd/tasks`. Deployment tests: `go test ./tests/deployment -v`; validate Docker build/Compose when installed, without deploying live data.
- Keep the independent Python release packaging helper/tests: `python3 -m unittest discover -s tests/release -v`.
- Web helpers: Node built-in tests in `tests/web` plus browser tests against a real isolated API/database.
- Windows: C# tests in `apps/windows/Tasks.Core.Tests` and `Tasks.Storage.Tests`, plus `node --test tests/windows/*.test.mjs`. Native publish/launch is a separate Windows gate; Linux compile checks are not distributable builds.
- Android: source `/opt/data/tools/android-env.sh`, then from `apps/android` run `bash gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug --console=plain --max-workers=2`.
- Do not run concurrent Gradle builds in this checkout. Do not install or clear data on a personal device or another project's emulator. The Tasks validation AVD (legacy identifier `daymark-validation-api29`) uses emulator-5584; emulator-5582 belongs to another task.
- Verify exact external URLs through `hermesdan.tail1a7c8f.ts.net:<port>` rather than assuming a container localhost is the user's desktop.

## Design
Approved Focus + queue, dark slate/mint. Current task panel, Not now behind its top-right three-dot menu, Mark done bottom-right, daily progress, waiting task selection. Larger phone type: descriptions/buttons16px/sp, queue titles18px/sp, metadata14px/sp. No weekday strip, sample reading encouragement, or removed footer slogans. Actual app has no exploration tabs or phone-scale slider.
Native Windows and Android use the approved Dedicated page flow from `mockups/tasks-detail-explorations-v1.html`: task activation opens details without changing focus; Edit switches to the page editor, confirmed Save returns to details, and Back returns to the originating list. Simplify task UI to name and schedule; omit Category, Priority and Description/Notes while preserving their existing stored values on edits. Keep web unchanged until separately requested.

## Windows updates
Use the same Velopack system as Windows Music, with user-initiated Settings actions: Check for updates → Download with progress → Restart and install. Inspect Music's actual implementation and pinned tooling rather than substituting a browser-only installer handoff. Disable automatic startup application of staged updates, reject downgrades, keep release transport independent of Tasks credentials, and publish the Windows feed/full package in the normal combined application release. Preserve the protected session and server-only task-data rules. Existing Inno installations need an explicit migration path; local tests and Linux compilation do not establish a native installed-app upgrade.

## Safety
Tasks is a branding change, not an installation identity change. Preserve Android package/signing identity, database paths, legacy `DAYMARK_*` configuration/secrets (except the explicitly renamed `TASKS_HOST` hostname setting) and session/storage keys. The primary Android updater manifest is `tasks-release.json`; publish a byte-identical `daymark-release.json` alias for installed legacy clients and support legacy-only historical releases; see `docs/rebranding.md`.

Never seed sample tasks or default credentials into the live database. Use temporary DBs and fixtures for tests, never the user's tasks. Do not expose `.data`, environment files, private signing material or repository source through static serving. Parameterize SQL, scope every task/history route and export to the authenticated user, preserve history on archive, and reject cross-origin browser mutations. Require HTTPS for production credential transport. Client task payloads/order stay in memory only, not persistent caches; credentials are exchanged for securely stored sessions. Never log raw passwords/tokens or claim a failed/offline write succeeded. Android updates must use actual GitHub releases, matching package/version/digest/signing identity, and explicit Android user confirmation; never publish automatically.
