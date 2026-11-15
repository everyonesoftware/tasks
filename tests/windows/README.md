# Windows core and UI-source acceptance

From the repository root:

```sh
bash tests/windows/test-core.sh
bash tests/windows/smoke.sh
node --test tests/windows/shell-contracts.test.mjs
```

The shell wrappers use this host's existing .NET SDK/ICU; `DOTNET_ROOT` can be overridden. Unit tests also run directly on Windows with `dotnet test apps/windows/Tasks.Core.Tests -c Release`, without a Go toolchain.

## Real API smoke

`smoke.sh` compiles `fixture/main.go` against this checkout's **real, unmodified** Go server package using a relative Go module replacement. The helper creates its own temporary SQLite database and two disposable fixture accounts, binds an ephemeral IPv4 loopback port, and removes the database when the C# runner closes stdin. It accepts no endpoint, database path, or credentials. All runtime temporary files use a new directory under `$TMPDIR`; the shell removes it on exit.

Ten real checks cover: isolated endpoint, initially empty authenticated account, create/focus, refresh, completion, undo, session restoration, second-user isolation, local logout clearing, and an independent HTTP 401 readback proving revocation of the exact former bearer token. The allowed loopback HTTP development exception is used; this does not verify a deployed HTTPS service.

The runner is separate from xUnit so default unit tests neither require Go nor silently skip an integration case. To invoke it directly, set `TASKS_API_FIXTURE` to the built disposable helper executable (not a server URL) and run `dotnet run --project tests/windows/Smoke -c Release`.

The smoke's `MemoryVault` tests the protocol/state core only. Actual Windows LOCAL=user encryption and native UI rendering require Windows acceptance; see `apps/windows/README.md`. Rendering-source contracts are not native screenshot or runtime-XAML tests.

## Core guarantees

The production constructor owns a normal TLS-validating HTTP handler with redirects and cookies disabled. Injected HTTP handlers are caller-owned test boundaries. Errors use fixed privacy-safe messages rather than response bodies or transport exception details.

Session replacement commits only after candidate login, authenticated state read, and an atomic vault save. Failed candidates preserve the working account and are revoked best effort. Network/malformed-response/cancellation failures clear task access; non-auth failures retain the protected session for refresh. Focus/order stays in memory and resets on account/date changes. No password or task record is passed to the vault.

The vault must atomically replace the endpoint/account/token envelope and preserve its prior committed value on save failure/cancellation. Deletion failures must be reported; local sign-out clearing is non-cancellable. An offline remote-revocation failure is explicitly different from confirmed server logout.
