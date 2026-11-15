# Tasks for Windows — Familiar

Native C#/WinUI 3 client, not a WebView. This is the first implementation slice of the selected **Familiar** direction in `mockups/tasks-windows-v1.html`.

## Included

- Slate/mint Windows workspace, left navigation, Current task, daily progress, queue selection, Not now, and bottom-right Mark done.
- Configurable server origin and existing-account sign-in. First-user provisioning remains the server's web welcome flow.
- Real authenticated task state, completion/undo, and task creation with repeat, interval, start date, category, priority, and notes.
- Upcoming and Routines views (read-only in this slice).
- Connection settings, test/reconnect, and local sign-out. There is deliberately no in-place account-switch form; sign out before changing accounts.
- Refresh on activation and every 30 seconds. Task payloads and suggestion ordering exist only in memory; disconnected/signed-out views clear them.
- One endpoint/account/session envelope encrypted for the current Windows user using `DataProtectionProvider("LOCAL=user")`, then committed with same-directory atomic replacement. No password storage. No plaintext task cache or write queue.

The native client's navigation uses the existing product's Today, Upcoming, Routines, and Settings routes rather than introducing a full-history endpoint. Completed today and Undo appear within Today.

## Not included yet

Task editing/archiving, full-history browsing, automatic updating, and tray/background behavior. Installer/release automation is implemented below, but its native Windows execution remains unverified until an authorized hosted run succeeds. Do not mistake the existing Android release manifest for a Windows update feed. No Windows installer has been published by these local changes.

## Structure

- `Tasks.App`: real WinUI controls, embedded runtime XAML, native credential protection, and window actions.
- `Tasks.Core`: platform-independent protocol/authentication/state/focus logic.
- `Tasks.Core.Tests`: executable core tests, including a disposable real-Go-server integration path.
- `Tasks.Storage.Tests`: real atomic-file persistence tests with cryptography injected at the OS boundary. These do **not** test Windows' actual data-protection implementation.
- `../../tests/windows/shell-contracts.test.mjs`: rendering-source contracts, **not** a native screenshot or XAML template test.

## Build on Windows

Prerequisites: Windows 10 2004+ x64, .NET SDK 10.0.404 (latest patch roll-forward), Node.js, full Git history, and the Windows SDK/WinUI build tools. From this directory:

```powershell
./build.ps1
```

This runs the C# tests and performs a native, self-contained publish to `artifacts/portable`, embedding the commit-count Windows version and exact source SHA. Keep the **entire folder** together; `Tasks.exe` alone is not the application. This command builds a development folder, not an installer or a signed release. Before distributing it, verify it launches on a clean Windows machine and that the merged WinUI theme resources and native runtime files are present.

Alternatively:

```powershell
dotnet publish Tasks.App/Tasks.App.csproj -c Release -r win-x64 -o artifacts/portable
```

Do not apply the Linux compile-only overrides below to a real Windows publish.

## Installer and GitHub release

From the repository root on Windows, with Inno Setup 6 installed:

```powershell
$build = (git rev-list --count HEAD).Trim()
./scripts/build-windows-installer.ps1 -BuildNumber $build -AllowUnsigned
```

The supplied build must match full Git history and lie in `1..65534`. Packaging first
runs the native build/tests, verifies the self-contained x64 payload and matching
executable FileVersion, then compiles `installer/Tasks.iss`. Output:

- `dist/windows/Tasks-Windows-N-Setup.exe`
- `dist/windows/Tasks-Windows-N-Setup.exe.sha256`

Existing staged bytes are never overwritten. For a deliberate local rebuild, remove
only your previous generated `dist/windows` directory first. The Inno compiler version
is logged. `-AllowUnsigned` acknowledges that no trusted publisher certificate is
applied and that Windows may display a SmartScreen warning.

The installer uses a stable per-user identity, installs to
`%LOCALAPPDATA%\Programs\Tasks`, creates a Start menu shortcut and registers a normal
uninstaller. It does not register launch-at-sign-in or enable automatic updates.
Uninstall removes installed files but deliberately preserves the separately protected
user-session directory; sign out in Tasks first if you also want the session revoked.

The main publishing workflow builds Windows alongside Android. Before uploading the
installer artifact it runs `scripts/test-windows-installer.ps1` on an isolated GitHub
Windows runner: actual install, installed native-window launch/render/screenshot,
graceful close and independently verified uninstall. The script refuses preexisting
Tasks installations or profiles and is not a personal-machine test command.
Diagnostics are retained on failure; failure blocks publication. The final release
job waits for both application jobs and attaches the two Windows files beside the
existing APK/manifest/checksum in **the same `vN` release**. No separate Windows release
or updater feed is introduced, and existing releases are not overwritten.

The workflow cannot run against these uncommitted local files. Commit/push and a
successful native hosted run are separate, still-required publication gates.

## Checks on this Linux build host

```sh
export PATH=/opt/data/tools/dotnet:$PATH
export LD_LIBRARY_PATH=/opt/data/tools/icu/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
dotnet test Tasks.Storage.Tests/Tasks.Storage.Tests.csproj -c Release
dotnet test Tasks.Core.Tests/Tasks.Core.Tests.csproj -c Release
node --test ../../tests/windows/*.test.mjs
dotnet build Tasks.App/Tasks.App.csproj -c Release \
  -p:OutputType=Library -p:WindowsAppSDKSelfContained=false \
  -p:PrepareForRunDependsOn=CopyFilesToOutputDirectory
```

The last command compiles the **integrated actual Windows/WinUI C# references** while skipping Windows-only manifest/resource deployment. Its output is **not distributable** and does not prove native launch, runtime-XAML property/template resolution, credential protection, rendering fidelity, or installation.

## Native acceptance still required

Use a disposable Tasks API/database and a dedicated test Windows user, never personal tasks or an existing user profile. Verify:

1. Launch, native theme resources, window controls and resize at restored/maximized sizes; compare against Familiar.
2. Sign in over trusted HTTPS. A release rejects arbitrary HTTP, embedded credentials, non-origin URLs, and redirects. Loopback HTTP is development-only and visibly warned about.
3. Create a real task, select another waiting task, defer with Not now, complete and undo; independently read back each mutation from the API.
4. Close/reopen and restore the same account from the actual LOCAL=user-protected envelope; ensure plaintext credentials/tasks are absent from local files.
5. Disconnect while the app is open: clear task content, disable mutations, reconnect, and verify state. Test session expiry and offline sign-out, including the unconfirmed remote-revocation notice.
6. Cancel and fail a task creation: preserve the draft while the dialog is open and never claim the write succeeded. Escape must not dismiss an in-flight write.
7. Sign out, restart, and confirm no account/task access. Verify other Windows users cannot decrypt the session.

Current execution evidence and explicit unverified gates are recorded in `../../docs/verification.md`.
