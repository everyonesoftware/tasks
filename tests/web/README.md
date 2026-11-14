# Frontend checks

## Node behavior checks

```sh
node --test tests/web/*.test.mjs
node --check apps/web/app.mjs
node --check apps/web/auth.mjs
node --check apps/web/state.mjs
```

Auth behaviors were added with vertical failing-test → implementation → passing-test cycles. Coverage: legacy cache purge before startup session check, cookie-only/nonredirecting same-origin requests, unauthenticated task access rejection, 401/network invalidation, failed credential replacement preserving old session, ignored login token/password nonretention, failed logout local clearing/revocation warning, and stale auth responses/parsing/failures after connection changes. Existing queue/Not now, escaping, server-state validation, date/mutation and refresh guards remain tested. `readCachedState` is now used only as a pure in-memory server-state shape validator; the application does not read a cache.

## Isolated browser fixtures — not API integration evidence

Start a **static-only**, disposable origin:

```sh
python3 -m http.server 8791 --bind 127.0.0.1 --directory apps/web
```

Then run in `browser_exec` with a fresh isolated browser session:

```python
exec(open('/opt/data/code/tasks/tests/web/browser-smoke.py').read())
```

The script requires `/api/auth/session` to return 404 before injection. It explicitly replaces fetch with test-only fixture responses; it does **not** prove real authentication, cookies, server ownership isolation, or HTTP mutations. It executes the actual web UI in Chromium and covers first-login form/read-only current origin, legacy purge, successful fixture login, safe HTML-looking task strings, no task/token/password browser-storage writes, Focus/queue/Not now, 320/390/1440px layout and phone typography, Settings/About link, invalid credential replacement, and offline/401 task removal. No real user data is seeded or touched.

A failed browser run can leave its fixture initialization script attached to that test session; use a new named browser session when rerunning after failure.

## Parent real-HTTP integration acceptance

Use a disposable real server/database and CLI-created accounts, never live user data:

1. Startup without cookie: no task request before session/auth; sign-in has proper labels/current origin. Check legacy localStorage keys are purged and no offline records appear.
2. Login incorrect/correct/rate-limited; verify actual HttpOnly/SameSite cookie and redirect refusal. Reload discovers a valid cookie, never a persisted task list.
3. Create/edit/archive with all contract fields, complete/undo, progress, waiting selection and menu/keyboard interactions. Verify exact server state/export after mutations. Not now/order stay in memory during refresh, reset on page reload.
4. Settings session test, failed credential replacement retaining old account, confirmed successful different-user switch clearing old account/tasks, same-user reauthentication (including changed password), successful logout/revocation.
5. Offline/network loss, 401 expiry, reconnect, and offline sign-out: no task payloads or task-form values remain visible; no unauthenticated writes; warning distinguishes local clearing from unconfirmed remote revocation. A failed remote logout cannot expire a server-managed HttpOnly cookie.
6. Verify actual two-user owner isolation using the backend integration suite and both clients. No GitHub API call/token/Android installation claims in web Settings.
7. Repeat task-form dialogs, keyboard focus/Escape, long titles/notes and 320/390px/desktop layouts against real HTTP. Cross-device focus/30-second refresh should reflect server changes without stale refresh overwrites.

`api-smoke.py` executed actual Chromium form sign-in/cookie authentication, task creation and completion/undo read-back, failed credential replacement, confirmed two-account switching, 320/390/1440px layout checks, offline logout/reload suppression, explicit re-login and server logout revocation against a disposable Python API/database. It requires the preinstalled `websockets` Python development package and Chromium. Its host-specific fixture context is restricted to `/opt/data/cache/scratch` and port 8793, not a user server. The fixture suite is deliberately not a substitute for this acceptance.

The sole persisted browser sign-out marker contains no credential/task data. Offline logout/reload behavior also has a Node regression test. Final executed results and limits are in `docs/verification.md`.

Re-run on this build host with a fresh fixture server (stop it afterward):

```sh
# Terminal 1: always creates a new scratch DB, never accepts a user DB path.
python3 tests/web/api_fixture.py
# Terminal 2: requires Chromium and the preinstalled websockets package.
python3 tests/web/api-smoke.py
```
