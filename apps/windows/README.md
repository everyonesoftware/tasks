# Tasks for Windows — Familiar

Native C#/WinUI 3 client, not a WebView. This is the first implementation slice of the selected **Familiar** direction in `mockups/tasks-windows-v1.html`.

## Included

- Slate/mint Windows workspace, left navigation, Current task, daily progress, queue selection, Not now, and bottom-right Mark done.
- App-colored draggable title area with native caption controls, embedded/runtime Tasks icon, and labeled navigation icons. Ctrl+N opens Add task without a whole-window shortcut tooltip. These shell changes still require native Windows rendering/hover/taskbar acceptance.
- Configurable server origin and existing-account sign-in. First-user provisioning remains the server's web welcome flow.
- Real authenticated task state, completion/undo, and task creation with repeat, interval, start date, category, priority, and notes.
- Upcoming and Routines views (read-only in this slice).
- Connection settings, test/reconnect, and local sign-out. There is deliberately no in-place account-switch form; sign out before changing accounts.
- Settings shows the running application's file version/build, manual GitHub update checks, last-check time and expandable plain-text release notes. A newer Windows installer opens in the default browser; run the downloaded installer yourself. No background checks, automatic downloads or automatic installation.
- Refresh on activation and every 30 seconds. Task payloads and suggestion ordering exist only in memory; disconnected/signed-out views clear them.
- One endpoint/account/session envelope encrypted for the current Windows user using `DataProtectionProvider("LOCAL=user")`, then committed with same-directory atomic replacement. No password storage. No plaintext task cache or write queue.
- Startup shows a neutral session-restoration view until the protected session, remote validation and initial task fetch resolve. Missing/expired sessions show sign-in; restoration failures show a connection screen whose Reconnect action retries the entire restore. Sign out remains available to clear a saved session after failure.

The native client's navigation uses the existing product's Today, Upcoming, Routines, and Settings routes rather than introducing a full-history endpoint. Completed today and Undo appear within Today.

## Not included yet

Task editing/archiving, full-history browsing, automatic updating, and tray/background behavior. Do not mistake the existing Android release manifest for a Windows update feed. The manual Windows checker uses the existing combined GitHub release's Windows installer assets; it does not consume the Android manifest.

## Version and manual updates

The current version comes from the **running app assembly**, not the server, Git history on the user's machine, or latest-release metadata. Packaged releases use `0.1.N.0` plus source-stamped informational version metadata; unversioned/non-release builds are labeled Development build and never reported as up to date based on a guessed build number.

**Check for updates** anonymously requests the latest stable release from the fixed `everyonesoftware/tasks` GitHub API endpoint. It distinguishes checking, current, newer, no releases, development and failed states. Failures/rate limits do not change the Tasks session or block task access. Results stay in memory. Requests disallow redirects/cookies, use normal TLS validation, send no Tasks credentials, and bound both metadata bytes and total time (including body reads).

A valid candidate must have canonical `vN` identity in `1..65534`, be non-draft/non-prerelease and include exactly one uploaded, nonempty `Tasks-Windows-N-Setup.exe` and matching `.sha256` sidecar, with exact HTTPS URLs under that same repository/release. Android-only or malformed/incomplete releases fail the check rather than being offered. Equal/older versions never offer a downgrade. Development builds can explicitly download the published release without claiming it is newer.

**Download update** opens only the validated Windows asset URL in the default browser. The app does not download bytes, verify the sidecar digest, launch the installer or claim installation succeeded; browser download and manual installer execution remain user-controlled. No separate Windows manifest, backend credentials, automatic execution or Android updater reuse is involved. Native Windows browser handoff and Settings rendering remain separate acceptance gates.

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
4. Close/reopen and restore the same account from the actual LOCAL=user-protected envelope; ensure plaintext credentials/tasks are absent from local files. Check that slow restoration never flashes sign-in or connection errors, no saved/expired sessions resolve to sign-in, and offline startup resolves to Connection required with working Reconnect and Sign out actions.
5. Disconnect while the app is open: clear task content, disable mutations, reconnect, and verify state. Test session expiry and offline sign-out, including the unconfirmed remote-revocation notice.
6. Cancel and fail a task creation: preserve the draft while the dialog is open and never claim the write succeeded. Escape must not dismiss an in-flight write.
7. Sign out, restart, and confirm no account/task access. Verify other Windows users cannot decrypt the session.

Current execution evidence and explicit unverified gates are recorded in `../../docs/verification.md`.
