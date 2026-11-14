# Daymark v0.1 API contract

Private, single-user application intended for a trusted Tailscale network. No multi-user accounts or public Internet deployment in v0.1. Never expose on an untrusted network without adding authentication and HTTPS. UI is the approved Focus + queue design, not the comparison board.

## Transport

Same-origin JSON REST under `/api`. Server serves `apps/web/` at `/`. Native Android client default base URL: `http://hermesdan.tail1a7c8f.ts.net:8787`, editable in connection settings. Web uses the current origin. No permissive CORS. Client sends its local ISO date (`YYYY-MM-DD`) in state requests and mutations. The server validates dates. Requests/response JSON use camelCase. API errors: `{ "error": "Human readable message" }` with 400/404/409/500 as appropriate. JSON request bodies capped at 64 KiB; errors must never expose stack traces or filesystem paths.

## Models

Task fields:
- `id`: opaque UUID string, assigned by server
- `title`: trimmed nonempty string, max 200
- `notes`: string, max 2000, default empty
- `category`: string, max 60, default `Personal`
- `repeat`: `once` | `daily` | `weekly` | `monthly` | `yearly`
- `interval`: integer 1..365, default 1
- `startDate`: ISO local date; anchors weekday/day-of-month/annual recurrence
- `priority`: integer 0..2 (2=high), default 0
- `createdAt`: UTC ISO timestamp, assigned by server

Occurrence fields are flattened for rendering:
`occurrenceId` (`taskId@dueDate`), `taskId`, `title`, `notes`, `category`, `repeat`, `interval`, `priority`, `dueDate`, `completed` (boolean), `completedAt` (UTC timestamp or null), `overdue` (boolean).

State:
```
{
  "date": "2026-11-14",
  "tasks": [Task],
  "today": [Occurrence],
  "upcoming": [Occurrence],
  "progress": {"completed": 0, "total": 0}
}
```

## Scheduling rules

- Start with NO sample tasks in real user data.
- Due list: at most one latest scheduled occurrence per task on or before requested date. An incomplete prior occurrence carries forward as overdue, not many duplicates for missed daily cycles. Older superseded missed cycles are not resurfaced. Today includes completed occurrences due today, plus overdue occurrences completed on the requested date. A completed previous-date occurrence is not counted tomorrow.
- Daily = every N calendar days, weekly = every N*7 days, monthly = every N months, yearly = every N years, anchored at `startDate`. Clamp month-end/leap day but retain the original anchor (Jan 31 -> Feb 28 -> Mar 31; Feb 29 annual -> Feb 28 in non-leap years).
- One-time tasks do not recur.
- Sort today's incomplete occurrences by dueDate ascending, then priority descending, then createdAt/id; completed occurrences last. UI suggests the first incomplete occurrence, but lets the user pick any waiting occurrence.
- `upcoming` contains the next scheduled occurrence strictly after requested date, one per task, sorted dueDate/priority. Future one-time tasks appear; completed one-time tasks do not.
- Completing an occurrence is idempotent and does not delete the task. Store `completedOn` (client date) and `completedAt` (UTC). Undo removes only that completion.
- Mutation validation: task exists and active, dueDate is an actual scheduled occurrence, dueDate <= supplied client date; reject invalid/future completions. Archived tasks are excluded everywhere.
- All writes use transactions and parameterized SQLite. Task edits keep id and creation timestamp. Updating a schedule does not manufacture completions. Archive deletes task from active lists, retaining history in database.

## Routes

- `GET /api/state?date=YYYY-MM-DD` -> State. Missing date uses server local current date.
- `POST /api/tasks` -> 201 Task. Input fields title, notes, category, repeat, interval, startDate, priority as above. title and startDate required; repeat defaults once.
- `PUT /api/tasks/{id}` -> 200 Task. Full editable-field replacement using same validation/defaults as create.
- `DELETE /api/tasks/{id}` -> 204. Archive, not destructive erase.
- `POST /api/occurrences/complete` -> 200 State. Body `{ "taskId": "...", "dueDate": "...", "date": "..." }`.
- `POST /api/occurrences/undo` -> 200 State. Same body. Idempotent.
- `GET /api/export` -> JSON download `{ "schemaVersion":1, "tasks":[raw active and archived tasks], "completions":[raw completion records] }`. For personal backups, no imports in v0.1.
- `GET /health` -> 200 `{ "status":"ok", "version":"0.1.0" }`.

## Client requirements

- Focus + queue dark slate/mint visual vocabulary from `mockups/daymark-focus-v8.html`. Current task, top-right three-dot menu containing Not now, Mark done bottom-right, progress bar. No calendar strip or removed helper/footer copy. Actual app has no mockup size controls or variant tabs.
- Today, Upcoming, Routines navigation. Add/edit/archive task forms. Show repeat schedule, first due date, custom interval, category, optional notes and priority. Routines rows offer edit/archive.
- Not now changes the suggestion without completing or changing schedules; choosing a queue row focuses it. Preserve local suggestion ordering per date where practical.
- Loading/error/empty/all-done states. Never show a failed write as completed. Disable duplicate mutations while requests are pending. Undo completion. Refresh on focus/resume and periodically (30 seconds) so web and phone reflect each other.
- Cache the last successful State for read-only display during a connection failure, clearly labeled; do not simulate successful offline writes. No offline write queue in v0.1.
- Native Android: actual Kotlin/Compose app, not a WebView wrapper; same API. User can edit server base URL. Do not hardcode credentials. Unit and UI tests should use fixtures only, never user tasks on a personal device.
- Web: native responsive CSS/JS, no framework/build dependency required. Phone body text ~16px, task rows 18px, metadata >=14px, buttons 16px and 44px hit targets. Desktop typography follows approved mockup. Native Android equivalent readable sp values.
