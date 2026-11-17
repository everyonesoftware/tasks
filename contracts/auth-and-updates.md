# Tasks authenticated connection + Android update contract

This supersedes the unauthenticated/offline-cache assumptions in `api.md`. Existing task/occurrence JSON shapes and recurrence rules stay unchanged. All task data/history remains on the server; clients may hold it in memory only while authenticated and connected. No persistent task payloads or task-order caches on devices. On connection loss/sign-out/account switch clear task state, disable access/writes, and remove legacy task caches.

The server is Go 1.26.11+ with pure-Go SQLite. Build from the repository root with `CGO_ENABLED=0 go build -o bin/tasks ./cmd/tasks`; `go run ./cmd/tasks` accepts the same CLI commands. The Tasks rebrand preserves technical compatibility identifiers and signing/storage identity; see `docs/rebranding.md`.

## Authentication

- First-user setup uses the approved **All in one** web screen: setup key, username and password in one form, with **Create account & start** leading to the actual empty Focus + queue workspace. No sample tasks or automatically opened task editor. Subsequent users remain server-admin CLI operations; no open self-registration and no seeded account/password.
- `GET /api/auth/setup` (also HEAD) is unauthenticated and returns only `{ "setupRequired": true|false }`, with `Cache-Control: no-store`, under the normal Host/transport guards. Clients check it before deciding between setup and session restoration/sign-in; a failed/malformed status response must show a retryable connection error, never guess that setup is available.
- On each successful server startup while no users exist, generate/rotate a one-time setup key and emit it to stderr with its expiry and a log-privacy warning. `./bin/tasks setup-key --db PATH` can explicitly rotate it without restarting and prints the new key on command stdout. The random 32-byte base64url key is never returned by HTTP; only its SHA256 digest and 30-minute expiry are stored. Restrict access to server logs: anyone who reads an active key can create the first account. Do not copy keys into chat, URLs, source or shared log exports. Restarting an unconfigured server or explicitly rotating invalidates the previous key. Configured servers never generate or log a setup key.
- `POST /api/auth/setup` accepts exactly `{ "setupKey":"...", "username":"...", "password":"..." }` over the same transport/origin/body guards as login. It creates the first user, consumes the valid key and establishes a session in one atomic database write transaction. Success is 201 with the same session response/cookie as login. Invalid/expired keys return 401, validation errors 400, already-configured servers 409, and rate-limited attempts 429 with Retry-After. Failed validation/database writes must not consume the key or leave partial users/sessions. Concurrent requests/CLI provisioning cannot create a second web-provisioned user. Legacy unowned tasks remain unassigned.
- Once any account exists, browser setup and setup-key generation are disabled. A competing setup completion leads the other browser to sign-in with an explanation. Returning signed-out visits show sign-in; passwords/keys/session tokens/task data are not persisted by the web app. Keys and password values are never sent in URLs or forwarded to another origin.
- `./bin/tasks create-user --db PATH --username NAME` prompts at a hidden terminal prompt; `--password-stdin` is available for automation/tests. Never log passwords or session tokens. A CLI password-reset option revokes that user's sessions. If legacy unowned tasks exist, do not assign them silently; provide explicit CLI adoption to an existing username.
- Username: 1..64 ASCII letters/digits/dot/underscore/hyphen, case-insensitive identity. Password: 8..1024 characters for provisioning; passwords are never trimmed. Store salted PBKDF2-HMAC-SHA256 (>=600,000 iterations) or equivalently appropriate password hashes, never plaintext.
- `POST /api/auth/login` body `{ "username":"...", "password":"..." }` -> 200 `{ "token":"opaque random secret", "username":"canonical name", "expiresAt":"UTC ISO timestamp" }`. Also set HttpOnly, SameSite=Strict `daymark_session` cookie, Secure under HTTPS. Generic 401 for wrong credentials; rate limit repeated failures with 429 + Retry-After. Do not send credentials to redirects.
- `GET /api/auth/session` -> 200 `{ "username":"...", "expiresAt":"..." }` or 401. It never returns password/token.
- `POST /api/auth/logout` -> 204, revoke the presented session and expire the cookie. No JSON body necessary. Native Bearer token and browser cookie sessions are both supported.
- Sessions: cryptographically random >=32 bytes, only token hash stored in SQLite, expiry enforced, logout revokes. Default lifetime 30 days. Send `Authorization: Bearer TOKEN` from Android. Web uses only the HttpOnly cookie, never localStorage tokens/passwords.
- Every `/api/state`, task/occurrence route, and export requires a session. Each task is owned by its user. Reads, edits, completion, undo, archive and export are owner-scoped; another user's IDs must look not-found. Do not export user/password/session tables.
- Keep Host, Origin, static-path, JSON and size protections. No permissive CORS. Browser Origin/Referer validation supports actual HTTPS and an explicit configured public reverse-proxy origin; do not blindly trust arbitrary forwarded headers.
- Production credential transport must be HTTPS. Server CLI supports `--tls-cert PATH --tls-key PATH` (Go `crypto/tls`) and optionally `--public-origin https://HOST[:PORT]` for a separately configured trusted TLS reverse proxy. Default HTTP login is allowed only on loopback for development. `--allow-insecure-http` explicitly enables the existing trusted encrypted-tailnet development setup; document that this is NOT a public/plain-Internet deployment. Never disable certificate validation in clients.

## Android connection flow

- A new installation has no saved endpoint or credentials and opens the approved first-launch screen: server URL, username, password. Initial endpoint is blank, hint HTTPS URL. Users obtain an account from their server administrator.
- Validate an HTTPS base origin (no credentials, query, fragment; no subpath for this version). Local HTTP development exceptions: localhost,127.0.0.1,10.0.2.2; exact `hermesdan.tail1a7c8f.ts.net` HTTP allowed only in debug builds with an explicit encrypted-tailnet development warning, not as default. Do not persist failed connection attempts.
- Test/authenticate a proposed connection before replacing a working one. Different endpoint or username requires switch confirmation. Failure/cancel keeps old connection/session; success clears old in-memory tasks and opens the new account's data. Re-enter password for changes; do not save it.
- Persist only endpoint, canonical username and opaque session. Protect token at rest with Android Keystore-backed encryption, disable backup/transfer, no secret logging. Endpoint/username are non-secret. Remove legacy `cache:*`, persisted focus/task-order data during migration.
- Settings navigation includes Connection and App updates panels. Review endpoint/account, test session, edit details, sign out. Auth failure/expiry returns to sign-in; network failure shows connection-required, no cached tasks. User-initiated sign-out clears local session even if server is unavailable; explain that remote revocation could not be confirmed then.
- Web sign-in follows the same session and server-only-data model. Browser is already at the server origin: server URL is read-only/current origin, not cross-origin credential forwarding. Web Settings reviews that connection/account and signs out; native update installation belongs only to Android.

## GitHub Android updates

Public repository: `everyonesoftware/tasks` (verified public, currently no releases). Do not fabricate availability or build numbers.

- Get latest stable release from `https://api.github.com/repos/everyonesoftware/tasks/releases/latest`. A 404 means no published release; failed checks are a distinct state and do not interrupt task access. Ignore draft/prerelease candidates.
- Stable release must contain `daymark-release.json` and an APK asset named by that manifest. Do not embed any GitHub credentials/PAT in the app.
- Manifest schema:
```
{
  "schemaVersion": 1,
  "packageName": "com.everyonesoftware.daymark",
  "versionName": "0.2.0",
  "versionCode": 2,
  "minSdk": 26,
  "apkAssetName": "Tasks-0.2.0-2.apk",
  "sha256": "64 lowercase hex characters"
}
```
- Manifest comes from that release's actual matching GitHub asset, not an arbitrary URL in release text. All initial metadata/asset URLs must be HTTPS and exactly the expected GitHub API/repository release paths. Redirects may go only to official GitHub release-asset hosts, capped hops; never forward the backend session token to GitHub.
- Compare integer `versionCode` to the actual installed version code; require expected package, valid bounds/digest and compatible minSdk. UI shows installed version/build from PackageManager and actual newer manifest info. Display real release notes; checking, up-to-date, no-releases and failed-check states are distinct.
- Check on app launch when enabled, plus manual check, but no automatic download/install. Persist only non-sensitive update-check preference; no fabricated release cache. APK is the only persistent download, in app-private cache, removed on cancel/failure/sign-out as appropriate.
- Download on IO coroutines with cancellation, bounded size/time, progress and atomic staging. Verify SHA256, package identity, exact expected version code, and the signing certificate against the installed app before offering install. Reject tampered, mismatched, older, incompatible, or differently signed APKs.
- Use FileProvider and Android's installer. Request install-source permission if necessary, with explicit user action. Never silently install, bypass signature/certificate checks, or claim installation success merely from starting an installer intent. Read the installed package/version back on resume; it is authoritative.
- Release builds use the full `git rev-list --count HEAD` as both Android versionName/versionCode and the web/server container version. CI computes it once from a full checkout; the Android build consumes `DAYMARK_VERSION` and the server embeds it via the Go linker. The manifest above is an illustrative historical shape, not current release availability. See `docs/ci-publishing.md`. Tests must use isolated fixtures, not publish a release or upload to GitHub.

## Windows updates

- Use Windows Music's Velopack system with three separate, explicit Settings actions: **Check for updates → Download with progress → Restart and install**. No automatic startup checks, downloads, restart, or application of a previously staged update. Run the Velopack startup hook with `SetAutoApplyOnStartup(false)` before WinUI initialization.
- Settings displays the running assembly's version/build. Release builds retain `0.1.N.0` and source-stamped informational metadata. Loose/development builds must not pretend to be installed updater-managed releases or offer an unverified upgrade.
- Discover Windows releases anonymously and independently of the Tasks client at the fixed `everyonesoftware/tasks` GitHub repository. Page the release inventory explicitly, select the numeric highest Windows feed rather than GitHub Latest or publication order, and fail closed on truncated or ambiguous inventory. Never send Tasks credentials to GitHub or disable TLS validation.
- Accept stable, non-draft `vN` releases (`1..65534`) containing `releases.win-x64.json` and exactly the matching `TasksWindows-0.1.N-win-x64-full.nupkg`. Validate repository/tag/asset origins and package/channel/version identity. Android-only releases and browser-only installer assets are not an in-app Windows feed; never consume `daymark-release.json` or an APK. Invalid selected feeds are failures, not permission to fall back to stale packages.
- Keep checking/current/available/downloading/ready/restarting/failed/not-installed states honest and retryable. Update failures must not clear the server session or block task access. No downgrade or install before a successful explicit download. Use Velopack's package verification; unsigned distribution does not imply a trusted publisher certificate.
- Restart/install requires another explicit user action and safe preservation of the protected session, with no pending task mutation discarded. Never persist task payloads or ordering to enable updating. Failure to preserve the session blocks restart. Window closure invalidates pending callbacks and cancels downloads; a download does not mean installation succeeded.
- Publish feed/full package/setup in the normal combined `vN` application release. Preserve discovery compatibility for the old browser-only checker and explicitly document the one-time transition from Inno installation to Velopack; never silently overwrite another installation or remove the protected session. Real Windows install/upgrade/restart/session/uninstall acceptance is separate from source tests and Linux compilation.

## Verification

Strict vertical TDD. Test login/logout/expiry/failure/rate-limit, two-user isolation for every route/export, password hashing and legacy migration, no persistent task caches, connection replacement failure preserving old session, no credentials persisted/logged, updates 404/failed/current/newer, wrong asset URL/hash/package/version/signer, cancel and installer gating. Actual builds and real API-backed browser/Android smoke are required. Do not seed user data, commit, push or publish without separate authorization.
