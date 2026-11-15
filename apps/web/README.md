# Daymark web v0.2.0

Dependency-free HTML/CSS/native ES modules. Serve `apps/web` at `/` alongside the authenticated same-origin `/api`. Open the backend origin, not `file:` or a separate production static host. Provision an account with the server administrator CLI; no demo accounts/tasks are created.

## Run with the Go server

From the repository root (Go 1.26.11+):

```sh
CGO_ENABLED=0 go build -o bin/daymark ./cmd/daymark
./bin/daymark create-user --db .data/daymark.sqlite3 --username dan
./bin/daymark serve --host 127.0.0.1 --port 8787 --db .data/daymark.sqlite3 --web-root apps/web
```

Enter passwords only at the hidden prompt. Open `http://127.0.0.1:8787/` for loopback development; production requires HTTPS. `go run ./cmd/daymark` accepts the same commands. Docker bundles the compiled server and these assets; see `docs/docker-deployment.md`.

## Connection and data safety

- Startup checks `/api/auth/session` before loading tasks. First login asks for username/password and shows the current origin read-only. Connection Settings reviews account/origin, tests the session, reauthenticates before saving changes, confirms different-user switches, and signs out.
- Web authentication uses only the browser-managed HttpOnly cookie. Requests use `credentials: same-origin`, `redirect: error`, and `cache: no-store`. Passwords are not trimmed, logged or persisted; login response tokens are ignored. Browser password-manager behavior is separate from application storage.
- No task payloads, history, focus/order IDs, passwords or session tokens are written to browser storage. Startup/sign-out remove legacy `daymark-state-v1` and `daymark-order-*` entries. Server state is validated in memory only. Not now/queue selection survive refreshes in the current page, not reloads.
- Connection loss/401/sign-out clear task lists, order, and open task forms. There is no offline task view, offline queue, service worker, or pretend successful write. Reconnect reads authoritative state before enabling mutations.
- Failed credentials do not replace a working cookie session. A successful reauthentication clears old task state before loading the account. A failed network request clears task data even when editing a connection.
- Sign-out immediately clears local state and stores only a non-sensitive signed-out marker (`daymark-signed-out-v1`). Automatic session restoration stays blocked across reloads until explicit successful sign-in. If the server cannot revoke the HttpOnly cookie, a warning says remote revocation is unconfirmed. Local sign-out is not a server revocation guarantee; only the server can revoke/expire that cookie.
- Task strings/account/origin are escaped or set using DOM text/value APIs. Existing task forms, archive confirmation, completion/undo, daily progress, Focus + queue and readable phone type remain.
- Settings About identifies web version 0.2.0 and links to Android GitHub releases. Browser code does not query GitHub, carry GitHub credentials, claim installed Android versions, or invoke an APK installer.

Production credential transport requires HTTPS and server Origin/Host protections. Loopback HTTP is for development; any explicit encrypted-tailnet HTTP exception belongs to backend deployment configuration, not permissive frontend CORS.

## Checks

Run from the repository root:

```sh
node --test tests/web/*.test.mjs
node --check apps/web/app.mjs
node --check apps/web/auth.mjs
node --check apps/web/state.mjs
```

See `tests/web/README.md` for isolated browser fixtures and the actual Chromium/API acceptance runner; see `docs/verification.md` for executed scope and remaining deployment limits.
