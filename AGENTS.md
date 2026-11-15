# Tasks working rules

One cohesive product: web, native Android, and a private single-user server. No commits or pushes without Dan's authorization.

## Ownership
- `apps/web`: responsive HTML/CSS/JS client; relative same-origin `/api` calls.
- `apps/android`: Kotlin/Compose client; configurable server base URL.
- `cmd/tasks`: Go CLI; `services/server`: Go HTTP API, recurrence engine, and pure-Go SQLite (`modernc.org/sqlite`).
- `contracts/auth-and-updates.md`: authoritative authentication, server-only-data, connection and Android updater requirements. It supersedes old no-auth/cache assumptions in `contracts/api.md`; task JSON shapes stay compatible.
- `mockups`: historical design artifacts, not production source.

## Checks
- Write a failing behavior test before each production behavior slice, verify RED, implement, verify GREEN.
- Backend/deployment: `go test ./...` and `go vet ./...` (Go 1.26.11+). Build: `CGO_ENABLED=0 go build -o bin/tasks ./cmd/tasks`. Deployment tests: `go test ./tests/deployment -v`; validate Docker build/Compose when installed, without deploying live data.
- Keep the independent Python release packaging helper/tests: `python3 -m unittest discover -s tests/release -v`.
- Web helpers: Node built-in tests in `tests/web` plus browser tests against a real isolated API/database.
- Android: source `/opt/data/tools/android-env.sh`, then from `apps/android` run `bash gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug --console=plain --max-workers=2`.
- Do not run concurrent Gradle builds in this checkout. Do not install or clear data on a personal device or another project's emulator. The Tasks validation AVD (legacy identifier `daymark-validation-api29`) uses emulator-5584; emulator-5582 belongs to another task.
- Verify exact external URLs through `hermesdan.tail1a7c8f.ts.net:<port>` rather than assuming a container localhost is the user's desktop.

## Design
Approved Focus + queue, dark slate/mint. Current task panel, Not now behind its top-right three-dot menu, Mark done bottom-right, daily progress, waiting task selection. Larger phone type: descriptions/buttons16px/sp, queue titles18px/sp, metadata14px/sp. No weekday strip, sample reading encouragement, or removed footer slogans. Actual app has no exploration tabs or phone-scale slider.

## Safety
Tasks is a branding change, not an installation identity change. Preserve Android package/signing identity, database paths, `DAYMARK_*` configuration/secrets, session/storage keys and `daymark-release.json`; see `docs/rebranding.md`.

Never seed sample tasks or default credentials into the live database. Use temporary DBs and fixtures for tests, never the user's tasks. Do not expose `.data`, environment files, private signing material or repository source through static serving. Parameterize SQL, scope every task/history route and export to the authenticated user, preserve history on archive, and reject cross-origin browser mutations. Require HTTPS for production credential transport. Client task payloads/order stay in memory only, not persistent caches; credentials are exchanged for securely stored sessions. Never log raw passwords/tokens or claim a failed/offline write succeeded. Android updates must use actual GitHub releases, matching package/version/digest/signing identity, and explicit Android user confirmation; never publish automatically.
