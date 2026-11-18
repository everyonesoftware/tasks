# Tasks for Windows — Familiar

Native C#/WinUI 3 client, not a WebView. This is the first implementation slice of the selected **Familiar** direction in `mockups/tasks-windows-v1.html`.

## Included

- Slate/mint Windows workspace, left navigation, Current task, daily progress, queue selection, Not now, and bottom-right Mark done.
- App-colored draggable title area with native caption controls, embedded/runtime Tasks icon, and labeled navigation icons. Ctrl+N opens Add task without a whole-window shortcut tooltip. These shell changes still require native Windows rendering/hover/taskbar acceptance.
- Configurable server origin and existing-account sign-in. First-user provisioning remains the server's web welcome flow.
- Real authenticated task state, completion/undo, task creation and editing with repeat, interval, start date, category, priority, and notes. Three-dot menus provide Edit and confirmed Archive (history is preserved), including the current task menu alongside Not now.
- Task-row action popups: Make current / Mark done for eligible Today occurrences, Undo for completed Today occurrences. Future occurrences cannot be focused or completed early. Upcoming and Routines include accessible task options.
- Connection settings, test/reconnect, and local sign-out. There is deliberately no in-place account-switch form; sign out before changing accounts.
- Settings shows the running application's file version/build and uses the same Velopack update system as Windows Music: **Check for updates → Download with progress → Restart and install**. Each action is user-initiated; starting the app does not apply a staged update.
- Refresh on activation and every 30 seconds. Task payloads and suggestion ordering exist only in memory; disconnected/signed-out views clear them.
- One endpoint/account/session envelope encrypted for the current Windows user using `DataProtectionProvider("LOCAL=user")`, then committed with same-directory atomic replacement. No password storage. No plaintext task cache or write queue.
- Startup shows a neutral session-restoration view until the protected session, remote validation and initial task fetch resolve. Missing/expired sessions show sign-in; restoration failures show a connection screen whose Reconnect action retries the entire restore. Sign out remains available to clear a saved session after failure.

The native client's navigation uses the existing product's Today, Upcoming, Routines, and Settings routes rather than introducing a full-history endpoint. Completed today and Undo appear within Today. Completed today is collapsed initially, displays its count, and keeps its expansion choice across normal refresh/navigation for the same account and date. Sign-out/account changes and local-date rollover reset it; this preference and task data remain memory-only.

## Not included yet

Full-history browsing, unattended updating, and tray/background behavior. Do not mistake the existing Android release manifest for a Windows update feed. The Windows updater requires its own Velopack feed and full package in the combined GitHub release.

## Version and Windows Music-style updates

The current version comes from the **running app assembly**, not the server, Git history on the user's machine, or latest-release metadata. Packaged releases use `0.1.N.0` plus source-stamped informational version metadata; unversioned/non-release builds are labeled Development build and never reported as up to date based on a guessed build number.

**Check for updates** uses an anonymous, Windows-specific GitHub release source for `everyonesoftware/tasks`, independent of the authenticated Tasks connection. It pages the release inventory and selects the highest numeric stable `vN` release containing a Windows feed, rather than assuming GitHub Latest is a Windows release. Truncated, malformed or ambiguous selected metadata fails closed. Rate limits and failed checks do not clear the Tasks session.

A valid candidate has canonical `vN` identity in `1..65534`, is non-draft/non-prerelease, and supplies `releases.win-x64.json` plus the matching `TasksWindows-0.1.N-win-x64-full.nupkg` from that same repository/release. Feed/package/channel/version identity is validated and downgrades are disabled. Android-only releases and installer-only releases are not in-app update packages. Loose development builds must first be installed through the updater-enabled installer.

**Download update** downloads through Velopack with progress and package verification; it does not restart or install. **Restart and install** is a separate explicit action and must not discard a pending task operation or an unsafe/unpreserved session. `SetAutoApplyOnStartup(false)` prevents a later normal launch from silently applying downloaded bytes. Task data and ordering remain memory-only; the existing protected session envelope is retained. Native Windows Settings, actual installed-app upgrades and protected-session survival still require Windows acceptance; Linux compilation and HTTP fixtures do not prove them.

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

This runs the C# tests, including the real Velopack-source tests, and performs a native, self-contained publish to `artifacts/portable`, embedding the commit-count Windows version and exact source SHA. Keep the **entire folder** together; `Tasks.exe` alone is not the application. This command builds a development folder, not an installer or a signed release. Before distributing it, verify it launches on a clean Windows machine and that the merged WinUI theme resources and native runtime files are present.

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

The supplied build must match full Git history and lie in `1..65534`; release inputs
must be committed and clean. Packaging runs the native build/tests, verifies the
self-contained x64 payload and matching executable FileVersion, then uses the
pinned Velopack **1.2.161** tool. It validates the full package's identity, inventory
and payload bytes. `installer/Tasks.iss` builds only an **unregistered transition
guard** around the genuine Velopack setup, not another application installation.
Output:

- `dist/windows/TasksWindows-win-x64-Setup.exe`
- `dist/windows/TasksWindows-win-x64-Setup.exe.sha256`
- `dist/windows/TasksWindows-0.1.N-win-x64-full.nupkg`
- `dist/windows/releases.win-x64.json`

Only the current setup filename is published; the old `Tasks-Windows-N-Setup.exe`
alias and its checksum are retired for future releases. Existing release assets
are unchanged. Old browser-only clients must download the current setup manually
for the one-time transition. The raw, unguarded Velopack
bootstrapper is not published. Feed and full-package bytes remain genuine Velopack
output, used directly by installed apps for later updates.

Existing staged bytes are never overwritten. For a deliberate local rebuild, remove
only your previous generated `dist/windows` directory first. `-AllowUnsigned`
acknowledges that no trusted publisher certificate is
applied and that Windows may display a SmartScreen warning.

The default per-user install root remains `%LOCALAPPDATA%\Programs\Tasks`; Velopack
owns its `current` application directory, `Update.exe`, Start menu shortcut and
`TasksWindows` uninstall registration. No launch-at-sign-in is registered. Uninstall
preserves the separately protected `%LOCALAPPDATA%\EveryoneSoftware\Tasks` session
directory; sign out in Tasks first if you also want the session revoked.

### One-time transition from the old installer

The old Inno installation is **not** a Velopack-managed installation. Setup refuses
to proceed while its stable legacy AppId is registered, rather than installing a
second copy or silently removing it. Close Tasks, uninstall Tasks once through
Windows Settings → Apps, then run the new setup. Do **not** delete the Tasks profile:
the old uninstaller preserves its protected session. The new setup also refuses
an existing Velopack registration or a nonempty/overlapping destination. Later
updates use Settings inside the installed app, not repeated setup execution.

The legacy GUID is retained solely for detection, not reused as a second uninstall
registration. Automated refusal tests and fresh installation acceptance do not
prove real old→new session restoration or a subsequent in-app upgrade; those remain
separate Windows acceptance gates.

The main publishing workflow builds selected Windows/Android platforms. Before uploading the
installer artifact it runs `scripts/test-windows-installer.ps1` on an isolated GitHub
Windows runner: actual install, installed native-window launch/render/screenshot,
graceful close and independently verified uninstall. The script refuses preexisting
Tasks installations or profiles and is not a personal-machine test command.
Diagnostics are retained on failure; failure blocks publication. The final release
job gates publication on the selected application jobs and attaches the Windows
setup aliases/checksums, feed and full package to the normal stable **`vN` release**.
Existing releases are not overwritten. The Windows feed is separate from the
Android manifest even when they share a user-facing release.

The workflow cannot run against these uncommitted local files. Commit/push and a
successful native hosted run are separate, still-required publication gates.

## Checks on this Linux build host

```sh
export PATH=/opt/data/tools/dotnet:$PATH
export LD_LIBRARY_PATH=/opt/data/tools/icu/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
dotnet test Tasks.Storage.Tests/Tasks.Storage.Tests.csproj -c Release
dotnet test Tasks.Core.Tests/Tasks.Core.Tests.csproj -c Release
dotnet test Tasks.Update.Tests/Tasks.Update.Tests.csproj -c Release
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
3. Create a real task; activate a waiting row with mouse/keyboard and choose Make current or Mark done; defer with Not now; expand/collapse the counted Completed today section and choose Undo from a row popup. Confirm refresh/navigation preserve expansion and account/date changes reset it. Future rows must never offer early focus/completion. Edit all fields through each view’s three-dot menu, cancel an archive, then confirm an archive and independently read back its preserved history from the API.
4. Close/reopen and restore the same account from the actual LOCAL=user-protected envelope; ensure plaintext credentials/tasks are absent from local files. Check that slow restoration never flashes sign-in or connection errors, no saved/expired sessions resolve to sign-in, and offline startup resolves to Connection required with working Reconnect and Sign out actions.
5. Disconnect while the app is open: clear task content, disable mutations, reconnect, and verify state. Test session expiry and offline sign-out, including the unconfirmed remote-revocation notice.
6. Cancel and fail task creation/editing: preserve the draft while the dialog is open and never claim the write succeeded. Let activation/periodic refresh run during an idle draft; disconnect and verify submission disables without losing typed fields. Escape must not dismiss an in-flight write. Exercise archive confirmation and disconnected/stale popup guards. These interaction/rendering checks require native Windows; source contracts and Linux compilation do not establish runtime acceptance.
7. Sign out, restart, and confirm no account/task access. Verify other Windows users cannot decrypt the session.
8. In an isolated Windows account, verify the one-time legacy uninstall/new setup transition preserves the protected session, then perform a genuine newer-package Check → Download → Restart/install and read the installed version/session back. Confirm launch never auto-applies staged bytes, failed downloads are retryable, open drafts/mutations block restart, and uninstall removes installation/registration/shortcuts without deleting the protected session.

Current execution evidence and explicit unverified gates are recorded in `../../docs/verification.md`.
