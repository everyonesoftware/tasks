# Frontend checks

## Node behavior checks

```sh
node --test tests/web/*.test.mjs
node --check apps/web/app.mjs
node --check apps/web/auth.mjs
node --check apps/web/state.mjs
```

These cover queue ordering, Not now, state validation, escaping, cookie-only same-origin requests, connection replacement, offline sign-out, stale responses and the removal of legacy task caches. Node unit checks are not browser/API integration evidence.

## Real Chromium + Go API acceptance

From the repository root with Go, Node 22+ and Chromium on PATH:

```sh
node tests/web/api-smoke.mjs
node tests/web/setup-smoke.mjs
```

The script builds the actual Go server, creates a fresh database and two disposable accounts under the system scratch directory (`TMPDIR`), starts an ephemeral loopback server, and launches Chromium with a fresh profile. It never opens a live user database and stops its server/browser when finished. It needs no npm packages and no Python.

Checks include first-login/current-origin display, actual HttpOnly cookie authentication, HTML-looking task escaping, no persistent browser task/credential data, completion/undo with independent API read-back, failed credentials preserving a session, confirmed two-account isolation, task creation from the browser, 320/390/1440px layouts, offline logout surviving reload, explicit re-login, and server-side logout revocation. A JSON report and PNG screenshot are saved in the reported scratch directory.

The persisted browser sign-out marker contains no task or credential data. Offline logout is local clearing, not proof of remote session revocation.

The separate first-run runner starts a genuinely empty database and verifies the operator `setup-key` command, unauthenticated setup status, the single-form welcome, rejected keys, responsive desktop/mobile layout, cookie-backed first-account creation, no browser credential/task storage, first-task creation with independent read-back, reload/session restoration, setup lockout after provisioning, subsequent sign-in and fail-closed setup-status errors with Retry. It writes a JSON report plus desktop/phone screenshots under the reported scratch directory and never prints the generated setup key.

## Backend contract checks

```sh
go test ./...
go test -race ./...
```

Backend tests use temporary SQLite databases and HTTP servers. They verify owner-scoped reads/writes/export, persistence, migration, authentication, recurrence and transport guards. Use actual client acceptance alongside those tests, not mocked fetch responses as a substitute.

Native Android is a separate client. Its builds and device tests remain described in `AGENTS.md` and `docs/verification.md`.
