# Daymark server v0.2.0

Go 1.26.11+ with pure-Go SQLite (`modernc.org/sqlite`). Build from the repository root with `CGO_ENABLED=0 go build -o bin/daymark ./cmd/daymark`. No Python runtime or system SQLite library is required. `go run ./cmd/daymark` accepts the same commands for development. No seeded account, password, or tasks. Run from the repository root. Task API shapes and recurrence are unchanged; all task data and exports now require authentication and are owner-scoped.

## Administrator commands

```sh
./bin/daymark create-user --db /private/daymark.sqlite3 --username Dan
./bin/daymark reset-password --db /private/daymark.sqlite3 --username Dan
./bin/daymark adopt-legacy --db /private/daymark.sqlite3 --username Dan
```

Create/reset asks for the password twice at a hidden terminal prompt without echoing it. For automation, add `--password-stdin` and supply exactly one password line through a protected pipe/input stream; never put passwords in command-line arguments, shell history, logs, or source. Only the terminating newline is removed; spaces remain part of the password. Passwords are 8..1024 Unicode characters with valid UTF-8 encoding. Usernames are 1..64 ASCII letters/digits/dot/underscore/hyphen, case-insensitive identity, with original spelling returned to clients. Duplicate names are rejected. Reset revokes every session for the account, including a concurrent old-password login.

Existing databases migrate in place without deleting tasks/completions. Legacy tasks get a NULL owner and remain invisible to every account until the administrator explicitly runs `adopt-legacy`. Adoption assigns **all still-unassigned tasks**, including archived rows and their completion history, to that existing account; it never reassigns owned rows. Back up before migration/adoption and verify the intended database/account. No registration, user deletion, per-task reassignment, restore/import, or HTTP account administration is implemented.

## Transport and startup

Loopback development (the default):

```sh
./bin/daymark serve --host 127.0.0.1 --port 8787 --db /private/daymark.sqlite3
```

Native HTTPS, using your actual certificate chain/private key paths:

```sh
./bin/daymark serve --host 0.0.0.0 --port 8787 --db /private/daymark.sqlite3 \
  --allowed-host daymark.example --tls-cert /private/fullchain.pem --tls-key /private/key.pem
```

Both TLS flags are required together. TLS 1.2 is the minimum. Clients must validate certificates; do not disable verification. Keep keys outside the web root.

A separately configured trusted **local** TLS reverse proxy:

```sh
./bin/daymark serve --host 127.0.0.1 --port 8787 --db /private/daymark.sqlite3 \
  --public-origin https://daymark.example
```

The proxy must terminate TLS, preserve the intended public origin, forward to the loopback listener, and prevent access to the backend from untrusted networks. `--public-origin` accepts an HTTPS origin only (no path, credentials, query, or fragment), enables Secure cookies, and defines the allowed browser Origin/Referer. It does not magically encrypt the backend connection. No `Forwarded`/`X-Forwarded-*` header is trusted. A non-TLS backend must remain loopback-bound; a remote proxy is not supported without direct backend TLS or an explicit development opt-in. Rate limiting uses the socket peer; all clients behind a local proxy therefore share its failure bucket.

Explicit private encrypted-tailnet development exception:

```sh
./bin/daymark serve --host 0.0.0.0 --port 8787 --db /private/daymark.sqlite3 \
  --allow-insecure-http
```

**This flag permits plaintext HTTP at the application layer. Use only behind a trusted encrypted tailnet and restrictive firewall, never on the public/plain Internet.** It is not automatic private-IP detection or a transport guarantee. Default HTTP API access requires a loopback bind, loopback peer, and loopback Host; spoofing a forwarded-protocol header cannot enable it.

`--port 0` selects an ephemeral port; the startup message reports it. SIGTERM/Ctrl-C closes the server. Default DB is `.data/daymark.sqlite3`; production should use a private absolute path and restrictive filesystem permissions. The static web root defaults to `apps/web`; `--web-root PATH` selects an assets directory, never the repository root. Relative paths resolve from the working directory. The container preserves `/app/apps/web` and runs in `/app`.

## Health check

```sh
./bin/daymark healthcheck --url https://daymark.example:8787/health --ca /private/fullchain.pem
```

Without `--url`, the URL is `https://$DAYMARK_HOST:8787/health`. The probe validates TLS trust and the certificate hostname, HTTP success, and the health payload, exiting nonzero on failure. `--ca` supplies a PEM trust bundle without disabling verification. Optional `--connect-address HOST:PORT` overrides only the dial socket; the URL hostname remains the TLS SNI/certificate identity and HTTP Host. Without it, `--url` uses normal DNS and port routing. Compose runs `/app/daymark healthcheck --ca /certs/fullchain.pem --connect-address 127.0.0.1:8787`; the internal port stays 8787 even if the published `DAYMARK_PORT` differs, with no container DNS or hairpin routing requirement. Health does not prove account access, external reachability, or a completed deployment.

## Authentication and isolation

- `POST /api/auth/login` takes JSON `{ "username": "Dan", "password": "..." }`; returns only `token`, canonical `username`, and UTC `expiresAt`. Also sets `daymark_session`, HttpOnly, SameSite=Strict, Path=/, 30-day Max-Age, Secure for native TLS/configured HTTPS proxy.
- `GET /api/auth/session` returns `username` and `expiresAt`, never the token/password.
- `POST /api/auth/logout` needs no body, revokes the presented session, expires the cookie, and returns 204. A missing/expired/revoked session returns 401; clients must still clear their local session if logout cannot reach the server.
- Native uses `Authorization: Bearer TOKEN`; browsers use the HttpOnly cookie. An explicitly present malformed/invalid Authorization header is rejected, not silently downgraded to a cookie. Duplicate Authorization headers/session cookies are rejected.
- Passwords use unique random 32-byte salts and PBKDF2-HMAC-SHA256 at 600,000 iterations; constant-time digest comparison. Unknown/malformed/wrong credentials take a dummy/real KDF path and return the same generic 401. Malformed JSON/transport/body violations remain 400. Invalid Unicode credentials are generic 401 at login and validation errors during provisioning, not encoding failures.
- Sessions contain 32 random bytes, with only SHA256 token digests stored. Expiry is enforced on every request. Logout deletes the session; password reset deletes all account sessions. Lifetime is 30 days without sliding renewal. Expired rows are harmless but not automatically pruned yet.
- Login permits five failures/in-flight attempts per socket peer per 60-second window, then returns 429 plus Retry-After. Successful logins do not clear prior failures. The limiter is concurrency-safe, bounded to 4096 peers, fail-closed at capacity, and memory-only (restart resets it); deploy an additional proxy/network limit for hostile traffic. It is not protection against distributed denial of service.
- State, create, edit, archive, complete, undo, and export all use authenticated ownership. Foreign IDs return 404. Export includes only that owner's active/archived tasks and completions, never users/password/session tables or owner IDs. No anonymous fallback, persistent client task cache, permissive CORS, or credential redirect is added.

`GET /health` is unauthenticated and returns version `0.2.0`. Static sign-in assets are public, but contain no task payloads. GET/HEAD API data is authenticated; HEAD sends the corresponding headers without a body. Unsupported methods pass through API security/authentication and return controlled JSON 405 errors (no echoed request/credentials).

## Guards, persistence, and backups

Host allowlist: `localhost`, `127.0.0.1`, `::1`, `10.0.2.2`, `hermesdan.tail1a7c8f.ts.net`, Tailscale IPv4 `100.64.0.0/10` and IPv6 `fd7a:115c:a1e0::/48` literals, plus explicit repeatable `--allowed-host HOSTNAME` and the configured public-origin host. This is defense in depth, not an IP firewall.

Browser writes reject cross-site/same-site Fetch metadata and mismatched supplied Origin/Referer, matching actual HTTPS or the exact explicit proxy origin as configured. No permissive CORS is emitted. JSON bodies require valid Content-Length and application/json; maximum 64 KiB, no chunked transfer. Socket reads/handshakes have a 10-second timeout; TLS handshakes are handled independently of the accept loop. Errors omit internal paths/tracebacks; requests, passwords, session tokens, and task bodies are not logged.

Only resolved files within the configured web root (default `apps/web`) are served, with dotfile/traversal/escaping-symlink rejection; the configured SQLite file and its WAL/SHM/journal are explicitly denied even if misplaced under the web root. Never put private keys, backups, credentials, or other secrets in the web root. Access to local files/DB is an administrator trust boundary.

SQLite WAL and transactional operation-local connections preserve task identity/history on edits/archive. Complete/undo remain idempotent, including concurrent completion. Month/year anchor recurrence and overdue progress are unchanged. Authenticated `/api/export` is an **account data export**, not a full multi-user database backup. For disaster recovery, use SQLite's backup facility or stop the server before copying the complete database safely; protect the resulting backup because it contains private task data and credential/session hashes. Undo removes its completion record; there is no immutable audit log.

## Verification

```sh
go test ./...
go vet ./...
```

Tests use only temporary databases, fixture credentials, ephemeral ports, and temporary certificates. Coverage includes real HTTP two-user CRUD/complete/undo/archive/export, cookie/Bearer login/session/logout/revocation/expiry, generic KDF/error behavior, rate limiting, password reset races, explicit legacy adoption, unchanged recurrence, Host/Origin/body/static guards, partial-body timeouts, Unicode validation, HEAD/method handling, CLI stdin provisioning/reset, and verified real HTTPS with stalled-handshake isolation. The TLS test requires the `openssl` executable only to generate an isolated test certificate; runtime needs only the compiled Go binary and web assets. External tailnet/firewall/proxy configuration and web/Android integration require separate verification.
