# Go server migration verification — 2026-11-15

The Python backend, backend tests and Python browser runners have been replaced by Go and a self-contained Node/Chromium acceptance runner. The HTML/CSS/JS UI and native Android client are unchanged. No live database, user account, personal device, commit, push or release was changed.

## Current migration gates

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
