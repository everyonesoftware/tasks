# All in one first-run setup — 2026-11-15

- Implemented the approved single-form web welcome: setup key, username and new password; successful first-account creation opens the real empty Focus + queue workspace. Returning users see sign-in. Setup detection failures fail closed with Retry, and no key/password/token/task payload is persisted by the client.
- Added operator-only `tasks setup-key --db PATH`: random 32-byte key, hash-only persistence, 30-minute expiry, explicit rotation, no normal-startup/log disclosure. The key, first user and session are checked/consumed/created in one SQLite writer transaction; setup/key generation refuse after an account exists. Existing accounts, legacy unowned tasks, database paths and session identity are preserved.
- Observed the new real-browser runner fail before implementation on setup status (401 instead of 200). Backend and web slices also exercised focused RED/GREEN tests. Coverage includes expired/rotated/malformed keys, duplicate JSON fields/Unicode, rollback at each write point, independent Store/subprocess concurrency, CLI provisioning races, migration preservation, HTTPS/Host/Origin/body guards, limiter recovery, form preservation, double-submit prevention and competing-setup conflict handling.
- `go test ./...`, `go test -race ./...`, `go vet ./...`, all 35 Node behavior tests, web module syntax checks, five existing independent release-packaging tests and `git diff --check` passed. Built `bin/tasks` with Go 1.26.11 and independently confirmed `CGO_ENABLED=0`. Deployment tests passed except rendered Compose, which skipped because the Compose plugin is unavailable.
- Final `node tests/web/setup-smoke.mjs` passed against an actual operator CLI, Go HTTP API, fresh scratch SQLite database and real Chromium. Verified initial setup, invalid key with no session, HttpOnly/SameSite=Strict cookie, empty state without forced editor, independently read-back first-task creation, session restoration, setup lockout, subsequent sign-in, no credential/task storage, 320/390/1440px layouts and setup-status failure/Retry. A second real browser tab verified that losing setup races clear secrets and show sign-in with an explanation rather than silently opening the winning account. Evidence: `/opt/data/cache/scratch/tasks-first-run-6vOkRy/setup-result.json`; desktop/phone screenshots in the same directory were visually inspected.
- Final `node tests/web/api-smoke.mjs` also passed: account isolation, cookie authentication, XSS escaping, completion/undo and task creation with independent read-back, About version, responsive layouts and offline sign-out/reload. Evidence: `/opt/data/cache/scratch/daymark-go-acceptance-VhEon4/web-result.json`. Acceptance caught the missing current-origin display on returning sign-in; a focused regression was verified RED/GREEN and both real-browser suites rerun afterward. The old sign-in-copy assertion was updated to target the new explicit “Sign in to Tasks” heading.
- Independent security/correctness review passed with no actionable security concerns or logic errors. The reviewer separately ran focused Go setup tests normally and under the race detector, Go vet, focused Node tests and whitespace checks. Suggested follow-up coverage: committed setup with a lost response, and a direct setup-status database-read failure. These were non-blocking test suggestions, not observed defects; real-browser execution above was performed by the parent, not claimed by the reviewer.
- No commit, push, release, deployment, live-database/account mutation or device installation was performed. Browser fixture processes were stopped. Docker build/runtime could not be exercised because the Docker daemon is unavailable; the Compose plugin is also absent. Android source was not changed, and Android builds/device tests were not rerun for this web/server feature.

---

# Automatic Android release workflow — 2026-11-15

- Added stable `vN` GitHub Releases after successful Android testing, signing, APK verification and artifact upload, with the exact APK, checksum and matching updater manifest. Only the Android job receives repository-content write permission. Older runs cannot promote themselves over current `main`; existing releases are not overwritten.
- New Go regressions were verified RED/GREEN. Tests execute the actual staging/publication shell with isolated SDK/GitHub boundaries, covering both SDK badging spellings, manifest identity/version/digest, current-head/old-run latest selection, remote failure, release creation failure, read-back failure and missing assets. Independent review caught the pre-existing-tag-only case where GitHub ignores `--target`; the correction resolves lightweight/annotated remote tags before creation and requires the expected tag commit afterward. Additional RED/GREEN regressions cover mismatched tags, matching annotated tags, absent/wrong post-create tags and lookup failures. Final race/vet/actionlint checks passed after the correction.
- `go test ./...`, `go test -race ./...`, `go vet ./...`, deployment tests, all five existing standalone release-packaging tests, actionlint v1.7.7 and `git diff --check` passed. The rendered Compose test skipped because the Docker Compose plugin is unavailable.
- Exercised the actual workflow staging shell against the existing signed release APK: signature verification passed; manifest recorded package `com.everyonesoftware.daymark`, versionName/versionCode `2`, minimum SDK `26`, asset `Tasks-2.apk`, and SHA256 `4b2bcbb5092c039588ac8ddfa67360ad3ef6cd82d5600947f86b17b3c2efa34a`. Copied APK bytes and digest matched independently. Evidence: `/opt/data/cache/scratch/tasks-release-staging-HoaGX9/`. This reused an earlier APK; no new Android build was performed. Initial inspection lacked Java on PATH; sourcing the documented Android environment resolved it.
- No commit, push, workflow dispatch, release publication, signing-key access, installation or live-data change was performed. Remote GitHub release creation and in-app discovery of that future release remain unverified until an authorized push/run. A fresh release-list read returned no releases.

---

# Authorized Android signing setup — 2026-11-15

- Reused the pre-existing production key; no key rotation or new signing identity. Verified alias `daymark` is a private-key entry, protected directory/file modes are 0700/0600, and its certificate is valid through 2054-04-01.
- Built the current Tasks release with that actual key. `:app:assembleRelease` passed; `apksigner` verified the APK and its certificate matched the existing keystore SHA256 `ef821ed3bfe07fb774f2708edcb300248d5b8f86f9d4765bfa0f31d0b2db47e4`. Actual APK metadata: label `Tasks`, package `com.everyonesoftware.daymark`, versionName/versionCode `2`, non-debuggable. Artifact: `apps/android/app/build/outputs/apk/release/app-release.apk`.
- Uploaded the four required repository Actions secrets to `everyonesoftware/tasks`: `DAYMARK_KEYSTORE_BASE64`, `DAYMARK_KEYSTORE_PASSWORD`, `DAYMARK_KEY_ALIAS`, `DAYMARK_KEY_PASSWORD`. Each exact secret endpoint was read back and its name/update timestamp verified after upload. GitHub does not expose plaintext secret values for read-back. Key/password values were supplied through private process environments or stdin, never command-line literals, output, chat or repository files.
- No commit/push, workflow dispatch, APK installation, GHCR publication or GitHub Release was performed. Remote workflow execution with these secrets remains unverified until the pending workflow is pushed and run. Back up the existing local signing key/password securely; GitHub secrets are not a retrievable backup.

---

# Tasks rebranding verification — 2026-11-15

The current product name is **Tasks**. Active CLI examples use `bin/tasks`, `cmd/tasks` and `/app/tasks`; new APK/artifact examples use `Tasks-`. See `rebranding.md` for unchanged installation, signing, configuration and storage identifiers. No source commit/push, publication, live database change, signing-key access or device install was performed for the rebrand.

- Branding/compatibility regressions were verified RED/GREEN for CLI help and unchanged DB default, export filename, container/artifact naming, web shell/PWA, Android labels/symbols, and release packaging/schema. The existing release packager now accepts the integer commit-count version and emits `Tasks-` APK filenames while retaining `daymark-release.json` and the original Android package ID. The schema also accepts historical APK prefixes.
- `go test -race ./...`, `go vet ./...`, actionlint and `git diff --check` passed. Built the real CGO-free `bin/tasks` with commit-count version `2`; its help identifies Tasks and the new executable name. Independent backend/deployment review found stale server README paths; corrected and rechecked them.
- All 23 web Node tests passed. Real isolated Go API/Chromium acceptance passed with Tasks title, accessible wordmark and sign-in copy; About/server version agreement; task mutation read-back; account isolation; no persistent task/credential data; 320/390/1440px layouts; and offline sign-out. Evidence: `/opt/data/cache/scratch/daymark-go-acceptance-fklPs0/`. The screenshot visibly retains the dark slate/mint Focus + queue layout with the Tasks wordmark.
- Final Android unit tests, debug APK, instrumentation-test APK assembly and lint passed. XML read-back confirmed 37 tests, zero failures/errors/skips. Actual final APK metadata confirmed label `Tasks`, unchanged package `com.everyonesoftware.daymark`, versionName `2`, versionCode `2`. Parent validation caught and corrected an unintended updater metadata filename rename; the legacy-asset regression failed before the correction and passed in the final full Android run.
- Five existing release-packaging tests and three absent/partial release-signing refusal tests passed. Rebranded Android production signing, device instrumentation/install, Docker runtime and remote GitHub publication were not exercised. The Docker daemon remains unavailable. Earlier signed/device evidence below predates the rebrand.

The records below predate the rebrand. Their original Daymark artifact names, binary names, paths, versions and execution results are retained as historical evidence, not claims about the current Tasks build.

---

# Historical CI publishing and commit-count versions — 2026-11-15

No source commit/push, GHCR publication, GitHub Release, signing-secret upload, live database change or device install was performed.

- Workflow actionlint validation passed. New regression tests were verified RED before implementation, then GREEN. The version helper was exercised against merged Git history (all five reachable commits counted) and rejected a shallow clone.
- `go test -race ./...`, `go test ./...` and `go vet ./...` passed. A separate linker-injected test run passed with the real commit count. An actual CGO-free server binary with an isolated scratch database returned `{"status":"ok","version":"2"}` from `/health`.
- All 21 web Node tests passed, including actual-version/error handling. Real isolated API/Chromium acceptance passed, including About matching `/health`, authentication, task mutation read-back, account isolation, no persistent task/credential data, responsive layouts and offline sign-out. Evidence: `/opt/data/cache/scratch/daymark-go-acceptance-DBziyJ/`.
- Android unit tests, debug APK, instrumentation-test APK assembly and lint passed. Unit XML read-back confirmed 37 tests, zero failures/errors/skips. Actual debug APK metadata confirmed package `com.everyonesoftware.daymark`, versionName `2`, versionCode `2`. Runtime configuration probes covered full-history fallback, explicit CI override, valid bounds, invalid values and shallow-history handling.
- The signed release path was exercised using a **disposable test key only**, no production signing material. `:app:assembleRelease` passed with `DAYMARK_VERSION=137`; `apksigner` and `aapt2` verified a signed, non-debuggable APK with the expected package and versionName/versionCode `137`. This is not a production artifact and was not published or installed. The test keystore was removed and the test APK moved outside normal release output to `/opt/data/cache/scratch/daymark-ci-signing-fixture-IKeFKf/Daymark-test-key-only-137.apk`.
- The existing independent release-packaging suite remains unchanged: five tests passed. All three missing/partial release-signing refusal checks also passed.
- Independent review found that an older workflow rerun could roll `latest` backwards despite serialization. The correction gates `latest` on the current remote `main` SHA while preserving numbered tags. A real local Git regression test was verified RED/GREEN for current-head promotion, old-run replay, and lookup failure. Final race/vet, shell syntax and actionlint checks passed after the correction.
- Docker build/runtime remains **unverified**: the installed Docker CLI has no reachable daemon; rendered Compose integration skipped because the Compose plugin is unavailable. Local binary/static deployment checks do not substitute for a Docker build.
- The repository currently has no configured Actions secrets. Production Android CI needs the four documented signing secrets before it can complete. No remote workflow run or GHCR permission/public-pull behavior was exercised because these changes have not been pushed.

See `ci-publishing.md` for workflow triggers, image tags, APK artifact policy, version semantics and setup prerequisites. Earlier migration/device/signing evidence below predates these version changes.

---

# Historical Go server migration verification — 2026-11-15

The Python backend, backend tests and Python browser runners have been replaced by Go and a self-contained Node/Chromium acceptance runner. The HTML/CSS/JS UI and native Android client are unchanged. No live database, user account, personal device, commit, push or release was changed.

## Migration gates at that verification

| Gate | Actual result |
|---|---|
| Go server | 34 tests passed |
| Go CLI, real listener, TLS, healthcheck routing and graceful shutdown | 14 passing test results, including four healthcheck subcases |
| Go deployment/configuration | 4 tests passed, including rendered standalone Compose configuration |
| Go race detector | All three packages passed |
| Go vet | Passed |
| Final compiler and CGO-free binary | `bin/daymark`, Go 1.26.11, `CGO_ENABLED=0` verified with `go version -m` |
| Vulnerability scan | No vulnerabilities found using the final project toolchain |
| Web Node behavior | 19 passed |
| Web ES module syntax | Passed |
| Android JVM | 37 passed; zero failures/errors/skips, verified from XML |
| Android debug/app-test assembly and lint | BUILD SUCCESSFUL |
| Unchanged Android release packager/signing-refusal checks | 5 packaging and 3 signing-refusal tests passed |
| Docker image build/run | Not verified: Docker daemon unavailable |

The minimum compiler and Docker build image were raised to Go 1.26.11 after scanning with the actual host Go 1.25.14 exposed standard-library advisories. Scanning by `go run` alone initially selected a newer scanner toolchain; the final scan explicitly checked the project's final compiler. The indirect `golang.org/x/sys` dependency was also raised to its advisory-fixed version.

Go tests cover database migration and explicit legacy adoption, Python-compatible hashes/schema, owner-scoped reads and mutations/export, password reset/session races, recurrence at calendar boundaries, same-day completion history, JSON validation, request size/deadlines, rate limiting, TLS/Host/Origin policy, and static-path/database-sidecar/symlink protections. HTTP requests rejected by Go's parser before dispatch may have Go's native HTTP 400 response instead of JSON; application-handler errors remain JSON.

Independent review found a healthcheck regression: dialing the public hostname introduced external DNS/hairpin/published-port dependencies. The corrected Compose healthcheck dials `127.0.0.1:8787` through `--connect-address`, while the HTTPS URL still supplies the configured hostname for certificate verification, SNI and HTTP Host. Real TLS regressions verify an unresolvable `.invalid` hostname works through loopback, wrong CA/hostname fail, and published port `9443` does not affect internal health. Independent re-review approved the correction with no security concerns, logic errors or remaining suggestions; its focused CLI/deployment, race and vet checks passed.

## Real clients against the Go API

- `node tests/web/api-smoke.mjs` passed on the final Go 1.26.11 build: actual Chromium cookies/login, task creation, completion/undo independently read back, failed account replacement preserving the session, confirmed account switching/isolation, XSS escaping, no browser task/credential persistence, 320/390/1440px layout, offline sign-out/reload suppression, explicit re-login and server logout revocation. Final report and screenshot: `/opt/data/cache/scratch/daymark-go-acceptance-9eAQy6/`.
- The desktop-facing `http://hermesdan.tail1a7c8f.ts.net:8793/` served the actual UI and `/health` returned `ok` / `0.2.0` during an explicitly insecure, temporary encrypted-tailnet development probe. This is not a production HTTPS deployment. The temporary server has been stopped.
- On the owned `daymark-validation-api29` / `emulator-5584`, installed the freshly built debug APK, used the actual first-install sign-in form against a disposable Go database via `adb reverse`, rendered `Go native acceptance task`, and tapped **Mark done**. Both native UI and an independent API read confirmed `1 of 1 complete`. Screenshot/UI evidence: `/opt/data/cache/scratch/daymark-native-go-51CM8g/`. The server and emulator were stopped afterward. This native smoke used the final HTTP/store implementation but preceded the compiler security upgrade from Go 1.25.14 to 1.26.11 and healthcheck-only CLI correction; final CLI/TLS, race and Chromium checks were rerun afterward. Full native instrumentation and a production-signed release were not rerun for this backend migration.

The separate Android release-packaging helper and its Python tests remain unchanged; Python is no longer required to build, run, provision or browser-test the web/API server. Back up an existing database using SQLite's backup API before any real deployment. Live cutover and Docker runtime validation remain unperformed.

---

# Historical Daymark v0.2.0 verification (Python backend)

Executed on 2026-11-14. No user database/accounts, personal device, source commits, pushes, or GitHub releases were changed.

## Automated gates

| Gate | Actual result |
|---|---|
| Python server | 40 passed; ResourceWarnings treated as errors |
| Release manifest packager | 5 passed; includes actual `aapt2` minimum-SDK spelling |
| Web Node behavior | 19 passed |
| Web ES-module syntax | app/auth/state checks passed |
| Android JVM | 30 passed, zero failures/errors/skips (XML read-back) |
| Android native API29 | 12 passed, zero failures/errors/skips (XML read-back) |
| Android debug/app-test assembly and lint | BUILD SUCCESSFUL; no lint errors, dependency/KTX warnings remain |
| Release-signing refusal probes | 3 passed: missing/partial configuration is refused without echoing values |
| Production-signed release assembly | BUILD SUCCESSFUL; actual SDK metadata and APK signature verified |

Server tests include real two-user HTTP isolation across routes/export, revocation/expiry/reset races, rate limiting, legacy adoption, verified HTTPS, Origin/Host checks, protected database/sidecars/static paths, finite reads, surrogate rejection, and recurrence/history behavior.

## Real browser/API acceptance

`tests/web/api-smoke.py` ran real Chromium form submissions and HTTP requests against a fresh scratch SQLite database, not mocked fetch responses. Verified:

- First-login fields and actual HttpOnly-cookie session restoration.
- Server-provided task rendering and HTML-looking task strings displayed safely.
- Completion and undo, each checked by a separate authoritative API read.
- Failed proposed credentials retaining the working session.
- Confirmed account switching and absence of the previous user's tasks.
- Browser task creation checked by a separate authoritative API read.
- No horizontal overflow at 320, 390, and 1440 pixels.
- Offline logout warning, reload suppression despite a surviving cookie, explicit re-login, and successful remote logout returning 401 afterward.
- No browser task/password/token persistence; the signed-out marker is non-sensitive.

The final runner exited 0. Its disposable server is stopped. Reproduction instructions and the loopback-only fixture server are in `tests/web/README.md`; the fixture cannot accept a user database path.

## Real Android/API acceptance

On the task-owned `daymark-validation-api29` / `emulator-5584` only:

1. Installed a production-signed 0.2.0/build2 APK.
2. Entered the isolated Python server URL and disposable account in the actual first-install form.
3. Rendered the same server-owned tasks used by browser acceptance.
4. Tapped native **Mark done**; a separate API read confirmed progress changed to 1 of 4.
5. Settings displayed the PackageManager version/build and a real GitHub **No published releases yet** response.

This production API smoke preceded the final update-status-only correction (sign-in must not fabricate a cancelled download). That correction was first reproduced by a failing native assertion, then all 12 native tests and 30 JVM tests passed, and the final signed APK was rebuilt and reverified. The task-owned emulator was stopped afterward; no other emulator/device was used.

## Final deliverable

- APK: `dist/android/v0.2.0/Daymark-0.2.0-2.apk`
- Manifest: `dist/android/v0.2.0/daymark-release.json`
- Package: `com.everyonesoftware.daymark`
- Version/build: `0.2.0` / `2`; minimum SDK `26`
- Actual APK SHA256: `081ed3b13865ac0400d7175ce8bc99fe2bc25a488677c8f9a2334eeffe621446`
- Actual signing certificate SHA256: `ef821ed3bfe07fb774f2708edcb300248d5b8f86f9d4765bfa0f31d0b2db47e4`
- `apksigner verify`: Verifies; APK Signature Scheme v2 true, one signer.
- Manifest checksum was independently recomputed from the copied APK bytes and matched.
- Private signing material remains outside Git and is not included in deliverables.

## Review

The initial independent review reproduced offline logout being undone by reload. It is fixed with a non-sensitive persistent signed-out marker; the regression failed before implementation and passed afterward, including real Chromium reload acceptance. Final independent re-review passed with no security concerns or logic errors. Its separate probe verified three reloads blocked cookie restoration without requests, three failed explicit logins retained suppression, and successful explicit login restored access. The suggested permanent failed-login/reload regression was incorporated into the existing Node test and rerun successfully.

Live GitHub probing also exposed an invalid binary Accept header on release metadata (HTTP 415). Metadata now requests GitHub JSON, while assets retain binary media. Two JVM regressions cover the request headers, and the production app's live check reached the correct no-release state.

## Deployment and explicit limits

- Production HTTPS/reverse-proxy/certificate deployment and a real user account are not provisioned by this feature build. See root `README.md` and `services/server/README.md` for administrator setup. There are no default credentials or seeded live tasks.
- GitHub repository was public and latest stable release returned 404 at verification. No release was fabricated or published. The app can check actual release availability, but a future newer GitHub APK download, modern install-source permission round trip, and in-place system-installer upgrade remain unverified end to end.
- Update policy, malformed/hostile assets, digest/package/version/signer rejection, cancellation cleanup, and installer gating have fixture/unit coverage; that is not a claim of a completed real newer-release installation.
- Debug and production APKs have different signing identities; a production APK cannot upgrade a debug-signed install in place.
- Offline sign-out can block local automatic restoration but cannot guarantee remote revocation while disconnected. The UI says so.
- Login limiting is in-memory and resets on restart; a local reverse proxy shares a limiter bucket. Expired session rows are not automatically pruned.
- This is not an offline task app: tasks/history persist on the server, and clients clear task access on disconnection.

## Initial-commit verification follow-up

Before the authorized initial commit, server (40), release packager (5), signing-refusal (3), deployment (2), and web Node (19) tests passed again, as did web syntax checks and real Chromium/API acceptance against a fresh disposable database. Signing probes required sourcing the Android environment. The host lacked the Docker Compose plugin; deployment tests passed using the official standalone Compose v5.7.1 binary after verifying its release checksum.

Independent pre-commit review found that separate Android session-field commits could pair a replacement endpoint with an old token after interruption. A failing regression reproduced that mixed session. The fix stores endpoint, username, and token in one authenticated encrypted envelope with one checked preference commit and rejects legacy split records. All 37 JVM tests now pass, including nine session-storage tests; debug APK/test APK assembly and lint pass. Lint retains 14 warnings and no errors.

The storage fix was tested with simulated write interruptions and real JVM AES-GCM authentication, not device power loss or a new Android Keystore runtime run. Earlier native/API29 and production-signed APK evidence above predates this final storage change; the listed signed artifact is not a build of the final committed source. No replacement signed release or GitHub release was produced by this commit follow-up.
