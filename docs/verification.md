# Android release manifest filename migration — 2026-11-18

- Primary metadata is now `tasks-release.json`; packaging and the combined release workflow also emit/publish byte-identical `daymark-release.json` for already-installed clients. New Android clients and publication baselines prefer the Tasks name and retain legacy-only release support. Failed, malformed or duplicate primary updater metadata cannot silently fall back.
- Regression tests were observed RED/GREEN for Android discovery and publication-baseline selection. Parent verification passed all 38 Android JVM tests (zero failures/errors/skips), debug APK and instrumentation APK assembly, Android lint, `go test -race ./...`, `go vet ./...`, all 5 independent release-packaging tests, all 113 deployment/Windows/web Node tests, actionlint and `git diff --check`. Windows PowerShell helper tests initially hit this host's missing ICU; rerunning with the documented `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1` passed without production changes.
- With authorization for the release filename change, added `tasks-release.json` to existing GitHub Latest release `v17` without replacing the legacy asset, APK, checksums or Windows installer. Downloaded the new 219-byte asset (ID `761208126`) and verified exact equality with the original manifest; SHA256 `0a3eadfc7464305f84a04bd1a09bf0b5a2a7764e66ebf191abe7d37aeb6619cd`. Re-read the exact release and verified all preexisting asset metadata (except naturally advancing download counts) and release source/title/notes/status were unchanged; Latest still resolves to v17. Snapshot evidence: `/opt/data/cache/scratch/tasks-manifest-remote-dTRw1w/`.
- No source commit/push, new binary release, signing-key change, device installation, live-data mutation or installed-app upgrade was performed. Source changes need an authorized push/build before they ship in a new APK; the existing v17 APK still uses the legacy name, which remains available.

---

# Windows Music-style updater migration — 2026-11-17

- Authorized feature commit `bd55927` was pushed as build **18**. Exact-SHA workflow **44198417046** failed in validation before native packaging/publication: selector-test fixtures hard-coded this host's scratch path when `TMPDIR` was absent on the GitHub runner. The correction uses Node's platform temp-directory fallback while retaining `TMPDIR` override support; no updater/installer production logic changed. Build 18 produced no new client release.
- Corrective commit `676eaa1` was pushed as build **19**; workflow **44199030592** passed validation, published the container, and intentionally skipped unchanged Android. Native Core/Storage/Update tests and self-contained WinUI publication passed, but full-package validation rejected Velopack's default omission of `createdump.exe`, so the client release was skipped. Packing now explicitly disables built-in and PDB exclusions instead of relaxing full-payload validation. A real pinned 1.2.161 scratch cross-pack preserved fixture executable, `createdump.exe` and PDB bytes exactly; its fixture-only hook bypass was not added to production packaging and is not native acceptance.
- Commit `a9147ef`, build **20**, workflow **44200302815** passed native packaging and actual guarded installation, including legacy-registration and repeat-setup refusal. The installed executable then exited with **0xC000027B** before window acceptance; no screenshot, successful graceful-close/uninstall acceptance or Windows release was produced. Failure cleanup completed without reported errors. Downloaded evidence: `/opt/data/cache/scratch/tasks-build20-evidence`. A bounded failure-only WinApp native-debugger step is being added to identify the underlying exception; debugger reruns cannot turn lifecycle failure into acceptance or publish its installer.
- Diagnostic commit `1ee7cae`, build **21**, workflow **44202210977** retained the failed acceptance result and captured the native crash: `System.NullReferenceException` / `0x80004003` in `WindowsUpdatesPanel` construction, then `MainWindow` and `OnLaunched`. The constructor dereferenced pre-load `Parent` relationships to insert controls/change help text. The correction declares Restart and instructions in runtime XAML and binds the named control directly, eliminating those parent traversals. New source regressions were observed RED/GREEN; all 77 Windows/deployment Node checks, 99 Core/23 Storage/27 updater managed tests and zero-warning Linux compilation passed. This remains a source fix until another actual installed-app lifecycle passes. Native debugger evidence: `/opt/data/cache/scratch/tasks-build21-evidence/native-debugger.txt`.
- Replaced browser-only update handling with Music's pinned Velopack 1.2.161 system: explicit Check → Download with progress → Restart and install, with startup auto-apply disabled before WinUI initialization. Anonymous paginated GitHub discovery selects the highest stable `vN` Windows feed/full package, validates TasksWindows/version/channel/origin and fails closed on malformed, ambiguous or truncated selected metadata. Downgrades and apply-before-download are blocked.
- Restart holds the native task-operation gate, refuses open edits/in-flight mutations, and reads the protected session back through the real client/vault boundary before apply. No task payload/order cache was added. The retired browser checker is test-only legacy-discovery coverage, not shipped update code.
- Packaging uses genuine Velopack full-package/feed output and an unregistered Inno transition guard. Public setup aliases preserve the old filename, but refuse existing Inno or Velopack registrations. A Windows-only release is not GitHub Latest (preserving Android compatibility), so old Windows clients must download it manually; the alias alone does not make it discoverable through their Latest-only checker. One manual old-install uninstall is required; the separate protected session is retained. This is an explicit transition, not a claimed automatic Inno upgrade. Full-package validation checks actual ZIP identity/inventory/native payload equality; only guarded setup aliases are published.
- Parent independently ran **99 Core**, **23 Storage/UI-policy**, and **27 updater** C# tests, all passing with no skips; real-reference Linux WinUI compilation passed with zero warnings/errors. The actual Go API smoke passed all **10 checks** using a disposable database. Packaging/lifecycle Node tests exercised actual PowerShell helpers and fail-closed non-Windows entrypoints, not Windows installation.
- Independent review approved the staged application/backend/controller/session-gate scope with no actionable security or logic findings, independently rerunning those managed suites and compilation. Packaging review caught incorrect Inno destination semantics and incomplete full-package inventory comparison before publication. Regression fixes enable Inno's actual directory mechanism, compare every published file against `lib/app` bytes with only verified pinned-tool-generated exceptions, and validate the exact shortcut target/arguments. Release-selection review also caught an unsafe skip for quoted YAML shared-input keys; unsupported layouts now conservatively select builds. Final independent re-reviews approved both corrected scopes with no remaining security or logic findings; reviewers reran the 49 Windows Node tests, 25 selection/orchestration checks, Go deployment tests, actionlint and PowerShell parsing as applicable. This approves local source/automation, not a native installed-app upgrade.
- Parent's final local run passed **109 Node tests** across Windows, deployment selection/orchestration and web, plus `go test ./...`, `go vet ./...`, actionlint and staged/working whitespace checks. `go test -race ./...` and all **5 existing independent release-packaging tests** passed. The public read-only selector verified Android's v17 source baseline and skipped Android while selecting Windows; container selection deliberately remains conservative because no durable verified container baseline was implemented. No live release, container or deployment was changed by that probe.
- Cross-project audit found Music, Tasks and the initial Storage Windows app. Music already uses this system and was left unchanged. Storage has no installer/updater/release pipeline, has an entirely uncommitted initial repository, and needs a production service-authorization/package-identity decision; it was not modified or represented as migrated. The shared app-development standard now requires Music's updater for Windows apps.
- Native fresh-install/render/close/uninstall acceptance is wired into the hosted Windows job. Real legacy-session transition, authenticated Settings interaction, a genuine later in-app upgrade, and protected-session restoration remain separate native acceptance gates. Linux tests do not establish them. No personal installation or live account/database was changed.

---

# Windows startup session restoration — 2026-11-17

- Added an explicit session-restoring startup view, visible in the initial XAML before any asynchronous work. Sign-in, connection-required and task workspace views stay hidden until restoration finishes. Successful restoration opens tasks directly; missing/expired sessions resolve to sign-in. No artificial delay, task cache, storage identity change or authentication bypass was added.
- Restoration errors/cancellation resolve to a retryable connection screen. Reconnect retries the protected-vault load, server session validation and initial task fetch rather than trying to refresh a null in-memory session. Local sign-out clears this retry state only after local credential deletion succeeds; deletion failures retain the existing sign-out retry policy.
- Independent review found that signing out after startup network failure deleted the envelope but skipped remote revocation because no active Session had been exposed. The client now retains a private revocation-only handle during restoration, without granting task access; sign-out attempts remote revocation and reports the existing unconfirmed-revocation warning when offline. Failed local deletion retains the handle for sign-out retry. Five new regression cases were observed RED before the correction and GREEN afterward.
- Observed RED/GREEN for the first-frame source regression and executable restoration-failure/retry policy. After the review correction, all **97 core C#**, **22 storage/UI-policy** and **42 Windows Node** tests passed, as did **10 disposable real-Go-API smoke checks**. A delayed real-TasksClient test verifies startup remains pending separately during vault loading, remote session validation and task-state retrieval. Real-reference Linux WinUI compilation passed with zero warnings/errors; `git diff --check` passed.
- These are source, managed behavior and compile checks, not native Windows rendering acceptance. Native slow-startup/no-login-flash, offline Reconnect/Sign out, expired-session transitions, actual LOCAL=user protection and self-contained installer verification remain required on Windows. Existing installer/release evidence predates these changes. No commit, push, publication, installation or live account/database changes were performed.

---

# Windows Settings version and manual updates — 2026-11-15

- Replaced the static development/updater disclaimer with a native Version & updates card: running app version/build, manual Check for updates, separate checking/current/available/no-releases/development/failure states, last-check time, expandable actual plain-text notes and an explicit browser download action. Equal/older releases do not offer downgrades; unrecognized development identities never claim to be up to date.
- The credential-independent checker reads the existing combined GitHub release, not Android's manifest. It requires canonical stable `vN` identity, exact repository/tag/Windows installer/checksum URLs and one uploaded nonempty asset of each expected name. Normal TLS, no redirects/cookies or Tasks credentials, a 1 MiB metadata limit, and a 20-second full-request deadline. Checks do not hold the task-operation gate. A new check clears old notes/downloads; close cancels requests.
- Observed RED/GREEN slices for version identity, release discovery, native Settings wiring, malformed source stamps and stalled-body deadlines. All **92 core C#**, **15 storage/UI-policy**, **41 Windows Node** tests and **10 disposable real-Go-API smoke checks** passed. Real-reference WinUI compilation passed with zero warnings/errors; `git diff --check` passed. No server/web/Android production changes or personal data were used.
- A scratch C# probe exercised the actual checker against public GitHub: returned Current for installed-build input 15, validated release build 15 and read 79 release-note characters. Separately compiled the actual WinUI assembly with the packaging helper's source-bound metadata and read it through the new helper: `Version 0.1.15 · Build 15`. These are actual public metadata/managed-assembly checks, not native installation evidence. Probe: `/opt/data/cache/scratch/tasks-windows-update-probe`.
- Independent source/security review returned no actionable findings. This is not native Windows acceptance.
- Download is **browser-mediated and manual**. The app validates metadata URLs/asset presence, not the downloaded executable digest or publisher signature; it does not stage bytes, execute installers or claim installation success. Browser handoff, native Settings rendering/interaction, and an actual newer-version upgrade remain unverified on Windows. Existing native/release evidence predates this source change. No commit, push, publication, personal-device installation or live-data change was performed.

---

# Windows native icon resource collision follow-up — 2026-11-15

- Authorized commit `1bf7195` was pushed to `main` as build 14. Exact-SHA workflow `43747737385` completed: validation, Android signed APK, container publication and Services notification succeeded; Windows publication failed with native PRI175/PRI277 duplicate `Files/Assets/Tasks.ico`. The combined GitHub release was skipped. This was a real Windows packaging regression missed by the earlier Linux compile/source checks.
- Evaluating the actual project with `dotnet msbuild -getItem:Content,None` reproduced two icon Content entries: the WinUI props' automatic image item and the project's explicit copied item, plus a default SDK None item. Removed those default icon entries before the explicit Content declaration, retaining executable branding and both copy metadata fields. Music uses the same remove/re-add pattern. A new focused regression was observed RED then GREEN.
- All 39 Windows Node tests passed, and actual MSBuild item readback now proves exactly one icon Content item, zero icon None items, and both copy-to-output/publish flags. Real-reference Linux WinUI compilation passed with zero warnings/errors; native publish and installer lifecycle must pass on the follow-up hosted run before claiming release success.

---

# Android adaptive launcher icon — 2026-11-15

- The supplied phone screenshot showed the old square Tasks drawable normalized inside a white circular launcher plate. Replaced the manifest launcher reference with a proper API26+ adaptive mipmap, using separate full-bleed slate background and transparent mint-symbol foreground layers. Both `android:icon` and `android:roundIcon` resolve to that adaptive artwork. The app's minimum SDK is 26; package, signing, storage and update identities are unchanged.
- The new launcher-resource regression was observed RED on the old drawable/missing round-icon declaration and GREEN after the resource/manifest change. Existing Android branding/upgrade-identity checks were updated to require the new launcher references.
- All **37 Android unit tests** passed with zero failures/errors/skips. Debug app APK, instrumentation-test APK and debug lint passed. The build emitted the existing command-line SDK XML-version warning. Read the compiled debug APK with `aapt2`: normal/round icon attributes resolve to the same mipmap resource, whose compiled XML contains `adaptive-icon` with separate background/foreground references. `go test ./...`, `go vet ./...` and `git diff --check` passed.
- No phone/emulator installation, device launcher screenshot, signed release, commit, push or publication was performed. Actual launcher appearance/cache refresh on Dan's phone remains to be checked after a released upgrade. The earlier Windows shell changes remain uncommitted and untouched by this Android slice.

---

# Windows shell polish — 2026-11-15

- Removed the root-level Ctrl+N accelerator's automatic hover tooltip while retaining the keyboard command. The root-owned accelerator was causing the whole-window shortcut hint shown in the supplied screenshot.
- Added a seven-resolution Windows ICO (16/24/32/48/64/128/256px) rendered from the existing `apps/web/icon.svg`, embedded into the executable and copied for `AppWindow.SetIcon`. Visually inspected the generated 256px icon and verified the runtime ICO appears in the compile output.
- Matched Music's extended-content/custom-drag-area approach: a slate 32px title area, transparent native caption-button backgrounds, and readable active/inactive foregrounds. Content and status rows remain separate from the drag area. Added native sun/calendar/repeat/settings navigation symbols with visible labels and explicit accessible destination/selected names; composite button content is no longer cast to a string.
- Each of the four source-contract regressions was observed RED before implementation and GREEN after. All **38 Windows Node tests**, **55 core C# tests**, **15 storage/UI-policy tests**, and **10 isolated real-Go-API smoke checks** passed. The actual WinUI project compiled against its real Windows references using the documented Linux library-only overrides, with zero warnings/errors. These checks do not exercise native pointer hover, runtime XAML rendering or Windows taskbar integration.
- Windows update checking/downloading/installation remains **unimplemented**; the Android updater manifest is not a Windows feed. No updater was added or availability claimed.
- Independent review found no actionable correctness/regression issues, reran all 38 Windows Node tests and the real-reference WinUI compile, decoded all seven ICO images and confirmed the copied runtime icon matches byte-for-byte. This is source/compile review, not native Windows acceptance.
- **Still required:** native Windows publish/install/launch; inspect taskbar/shortcut branding, hovering without Ctrl+N hints, the retained Ctrl+N command, dark captions in active/inactive/restored/maximized/high-DPI windows, dragging/system buttons, and all navigation labels/icons/selection. This host cannot run native Windows UI, and the installed application is unchanged. No commit, push, release, installation or live-data change was performed. Earlier native/release evidence predates these source fixes.

---

# Windows installer and combined release automation — 2026-11-15

- Added a per-user unsigned Inno Setup installer with a stable Windows AppId, Start menu shortcut and normal uninstaller. The default install directory is `%LOCALAPPDATA%\Programs\Tasks`; protected sessions remain separately under `EveryoneSoftware\Tasks` and are not deleted by uninstall. No automatic updater, startup registration, certificate purchase or new signing identity was introduced.
- `scripts/build-windows-installer.ps1 -BuildNumber N -AllowUnsigned` runs the native build/tests, validates the actual self-contained x64 runtime/merged PRI and executable FileVersion, compiles the Inno script, and stages exactly `Tasks-Windows-N-Setup.exe` plus its `.sha256` sidecar. Source-bound commit-count validation rejects shallow history, noncanonical/mismatched counts and .NET version-component overflow. Inventory tests reject missing runtimes, wrong architecture, case-fold duplicates, links and private database/session/key files; staged files are never overwritten. Synthetic PE fixtures are unit-test inputs only, not installers or native execution evidence.
- The main workflow builds Android and Windows after validation. A combined repository-write release job waits for both successful application jobs; the Windows artifact is uploaded only after a five-minute native installer lifecycle gate. The same `vN` release receives the existing signed APK, Android manifest/checksum, and both Windows files. Existing tag-source, remote-head/latest, existing-release failure and exact uploaded-asset readback guards remain. New pinned artifact downloads fail on digest mismatch; container and Services publication remain independent and unchanged.
- `scripts/test-windows-installer.ps1` refuses preexisting Tasks installations, registrations, shortcuts and profiles. It scopes the actual Inno installation to a unique runner-temp directory, checks installed native files/registration/shortcut, requires a repeatedly responsive window owned by the exact installed executable, captures foreground DWM bounds/nonblank app-content pixels, closes gracefully, uninstalls and independently verifies removal. Failure cleanup is bounded, exact-path scoped and cannot turn a failed lifecycle into success. Scalar JSON, logs and available screenshots are retained separately with `if: always()`.
- Parent verified RED/GREEN packaging/orchestration regressions and ran all **72 Node tests** across web, Windows and deployment orchestration: zero failures/skips. These include real PowerShell AST/helper execution, actual C# interop compilation, child-process argument/nonzero/timeout handling, fail-closed Linux execution with retained failed evidence, and cleanup/no-op/path-scope rejection. `go test ./...`, `go vet ./...`, actionlint **v1.7.12**, PowerShell syntax checks and `git diff --check` passed. The actual release shell was exercised through the Go deployment harness with local-only Git/GitHub boundaries, including missing Windows installer/checksum, wrong tag source, old reruns, lookup/create/readback failures and publication permissions/gates.
- Existing Windows C# suites passed again: **55 core** and **15 storage/UI-policy** tests. Windows-targeted library compilation passed with zero warnings/errors; actual managed PE version readback verified `0.1.12.0` and exactly one `+d91cfb3c2e90ce50a9ea7abf51d7b30da3fcb945` source suffix for the current local commit-count probe. An observed duplicate SDK-added SHA suffix was corrected with `IncludeSourceRevisionInInformationalVersion=false`. This is **not** an installer, installed version or release-availability claim.
- Independent final installer/release review passed with no reported security concerns, logic errors or suggestions. It independently ran 26 focused Node checks and the complete Go deployment test package. Parent also compared the container and Services job bodies with HEAD and confirmed they are unchanged. This approves the scoped local source/automation, not a native Windows installer or hosted publication.
- **Not executed:** actual Windows self-contained publication, Inno compilation, installation/render/screenshot/uninstall, hosted GitHub Actions and release upload/download verification. The local host is Linux; packaging/lifecycle entrypoints actually refuse to report a native pass here. All native operations are gated for a future authorized Windows runner. No commit, push, workflow dispatch, repository release, personal-device installation, live-task/database mutation or signing-secret change was performed. Existing releases were only read for discovery, not modified.

---

# Native Windows Familiar — initial slice, 2026-11-15

- Added a real C#/WinUI 3 client in `apps/windows`, not a WebView or shipped HTML mockup. The Familiar shell preserves Current task, the top-right Not now menu, bottom-right Mark done, daily progress and queue selection. Connected features include existing-account sign-in/session restoration, task creation, completion/undo, read-only Upcoming/Routines, connection testing/reconnect and sign-out. Task editing/archiving, full history, installer/release/update automation and native rendering acceptance remain out of scope for this first slice.
- Task payloads and focus order remain in memory. One endpoint/canonical-account/token envelope is protected with Windows `DataProtectionProvider("LOCAL=user")` and atomically replaced only after encryption succeeds. No password storage, task cache, credential redirects, cookie-based native transport or certificate bypass. Production transport requires HTTPS; literal loopback HTTP is an explicit development exception. Native Windows protection has compiled but has **not** been exercised on Windows.
- Observed vertical RED/GREEN slices for core behavior, shell/action contracts and credential-deletion recovery. Independent UI review found that keeping Add task open suppressed monitoring; the fix separates modal ownership from network-operation exclusion. Executable policy tests cover idle-editor monitoring, duplicate/in-flight writes, disconnect/reconnect and cancelled/failed submissions. Native task views are cleared and submission disabled on detected disconnect/expiry without discarding an open draft. Subsequent review found that task content remained visible during slow logout revocation: sign-out now suspends task access and clears native views before waiting for the server; a blocked-remote policy regression was observed RED/GREEN. Failed credential deletion exposes a reachable Sign out retry rather than an unusable sign-in form.
- Parent reran **55 core unit tests** and **15 real-file storage/UI-policy tests**, all passed with zero failures/skips. Atomic-file tests inject the cryptography boundary and cover encrypted bytes, tampering, failed replacement, cancellation before work and after protection, cleanup and deletion scope; these are not a substitute for actual Windows cryptography. **11 Windows source contracts** and the existing **35 web Node tests** passed. Shell XAML/manifest/project XML and PowerShell syntax parsed; the native build script actually failed closed on Linux as intended.
- Parent reran `bash tests/windows/smoke.sh`: **10 checks passed** against the actual Go HTTP handler, two disposable accounts, an ephemeral loopback listener and a new scratch SQLite database. Covered empty authenticated state, create/focus, refresh, complete, undo, bearer restoration, account isolation, local sign-out and independent HTTP 401 readback for the exact revoked token. The runner accepts no live endpoint/database/credentials. Smoke caught a real interoperability issue during development: .NET streaming JSON used chunked bodies rejected by the API; fixed-length UTF-8 JSON is now covered by protocol tests and this actual API run.
- Integrated Windows-targeted C# compilation of `Tasks.App` passed with **zero warnings and errors**, using real WinUI/Windows SDK references. Linux-only command overrides: `-p:OutputType=Library -p:WindowsAppSDKSelfContained=false -p:PrepareForRunDependsOn=CopyFilesToOutputDirectory`. The resulting library is **not distributable**. Normal Windows project defaults retain self-contained deployment and merged WinUI PRI generation; `build.ps1` checks the actual native output inventory but its Windows branch has not run here.
- `go test ./...`, `go vet ./...`, fixture Go vet, shell syntax and `git diff --check` passed. C# test evidence: `/opt/data/cache/scratch/tasks-windows-test-results/core-final.trx` and `storage-ui-final.trx`. No server/web/Android production code changed. Android/device, legacy Python release-packaging and Docker/deployment runtime checks were not rerun for this Windows-only slice.
- Independent final re-review passed with no remaining reported security concerns or logic errors after the modal-monitoring and sign-out fixes. The reviewer independently reran 55 core, 15 storage/UI-policy and 11 source-contract tests. This is source/logic approval, not native Windows acceptance.
- **Still unverified:** Windows launch, runtime-XAML property/template/theme resolution, native screenshots/restored/maximized geometry, actual LOCAL=user encrypt/reopen across Windows users, self-contained native publication, installation/uninstallation and updates. No Windows installer or release has been produced or published. No commit, push, live account/database change or personal-device installation was performed. See `apps/windows/README.md` for native acceptance.

---

# Startup setup-key logging — 2026-11-15

- Unconfigured server startup now rotates a random 32-byte setup key and emits it to stderr with its 30-minute expiry and a warning to keep logs private. Configured servers emit no key. The explicit `setup-key` command remains available for rotation without restarting; HTTP never returns the key and SQLite still stores only its digest.
- New subprocess lifecycle regression was observed RED before implementation and GREEN afterward. It verifies startup disclosure, restart rotation, old-key rejection, successful account creation using the new key, and suppression after setup. Tests use disposable databases only.
- `go test ./...`, `go test -race ./...`, `go vet ./...`, `CGO_ENABLED=0 go build -o bin/tasks ./cmd/tasks`, all 35 Node behavior tests and `git diff --check` passed with Go 1.26.11.
- Real Chromium setup acceptance consumed the startup-log key without an administrator key-generation command and passed first-account creation, cookie/session, competing-tab, first-task read-back and setup-lockout checks. Evidence: `/opt/data/cache/scratch/tasks-first-run-uKGsUc/setup-result.json`. Existing real-API browser acceptance also passed: `/opt/data/cache/scratch/daymark-go-acceptance-N2ik4h/web-result.json`.
- No commit, push, deployment or live database changes. Android and release packaging are unchanged and were not rerun. The historical no-startup-disclosure behavior described below is superseded by this change.

---

# All in one first-run setup — 2026-11-15

- Implemented the approved single-form web welcome: setup key, username and new password; successful first-account creation opens the real empty Focus + queue workspace. Returning users see sign-in. Setup detection failures fail closed with Retry, and no key/password/token/task payload is persisted by the client.
- Added operator-only `tasks setup-key --db PATH`: random 32-byte key, hash-only persistence, 30-minute expiry, explicit rotation, no normal-startup/log disclosure. The key, first user and session are checked/consumed/created in one SQLite writer transaction; setup/key generation refuse after an account exists. Existing accounts, legacy unowned tasks, database paths and session identity are preserved.
- Observed the new real-browser runner fail before implementation on setup status (401 instead of 200). Backend and web slices also exercised focused RED/GREEN tests. Coverage includes expired/rotated/malformed keys, duplicate JSON fields/Unicode, rollback at each write point, independent Store/subprocess concurrency, CLI provisioning races, migration preservation, HTTPS/Host/Origin/body guards, limiter recovery, form preservation, double-submit prevention and competing-setup conflict handling.
- `go test ./...`, `go test -race ./...`, `go vet ./...`, all 35 Node behavior tests, web module syntax checks, five existing independent release-packaging tests and `git diff --check` passed. Built `bin/tasks` with Go 1.26.11 and independently confirmed `CGO_ENABLED=0`. Deployment tests passed except rendered Compose, which skipped because the Compose plugin is unavailable.
- Final `node tests/web/setup-smoke.mjs` passed against an actual operator CLI, Go HTTP API, fresh scratch SQLite database and real Chromium. Verified initial setup, invalid key with no session, HttpOnly/SameSite=Strict cookie, empty state without forced editor, independently read-back first-task creation, session restoration, setup lockout, subsequent sign-in, no credential/task storage, 320/390/1440px layouts and setup-status failure/Retry. A second real browser tab verified that losing setup races clear secrets and show sign-in with an explanation rather than silently opening the winning account. Evidence: `/opt/data/cache/scratch/tasks-first-run-6vOkRy/setup-result.json`; desktop/phone screenshots in the same directory were visually inspected.
- Final `node tests/web/api-smoke.mjs` also passed: account isolation, cookie authentication, XSS escaping, completion/undo and task creation with independent read-back, About version, responsive layouts and offline sign-out/reload. Evidence: `/opt/data/cache/scratch/daymark-go-acceptance-VhEon4/web-result.json`. Acceptance caught the missing current-origin display on returning sign-in; a focused regression was verified RED/GREEN and both real-browser suites rerun afterward. The old sign-in-copy assertion was updated to target the new explicit “Sign in to Tasks” heading.
- Independent security/correctness review passed with no actionable security concerns or logic errors. The reviewer separately ran focused Go setup tests normally and under the race detector, Go vet, focused Node tests and whitespace checks. Suggested follow-up coverage: committed setup with a lost response, and a direct setup-status database-read failure. These were non-blocking test suggestions, not observed defects; real-browser execution above was performed by the parent, not claimed by the reviewer.
- No commit, push, release, deployment, live-database/account mutation or device installation was performed. Browser fixture processes were stopped. Docker build/runtime could not be exercised because the Docker daemon is unavailable; the Compose plugin is also absent. Android source was not changed, and Android builds/device tests were not rerun for this web/server feature.

---

# Automatic Android release workflow — 2026-11-15

- Added stable `vN` GitHub Releases after successful Android testing, signing, APK verification and artifact upload, with the exact APK, checksum and matching updater manifest. Only the Android job receives repository-content write permission. Older runs cannot promote themselves over current `main`; existing releases are not overwritten.
- New Go regressions were verified RED/GREEN. Tests execute the actual staging/publication shell with isolated SDK/GitHub boundaries, covering both SDK badging spellings, manifest identity/version/digest, current-head/old-run latest selection, remote failure, release creation failure, read-back failure and missing assets. Independent review caught the pre-existing-tag-only case where GitHub ignores `--target`; the correction resolves lightweight/annotated remote tags before creation and requires the expected tag commit afterward. Additional RED/GREEN regressions cover mismatched tags, matching annotated tags, absent/wrong post-create tags and lookup failures. Final race/vet/actionlint checks passed after the correction.
- `go test ./...`, `go test -race ./...`, `go vet ./...`, deployment tests, all five existing standalone release-packaging tests, actionlint v1.7.7 and `git diff --check` passed. The rendered Compose test skipped because the Docker Compose plugin is unavailable.
- Exercised the actual workflow staging shell against the existing signed release APK: signature verification passed; manifest recorded package `com.everyonesoftware.daymark`, versionName/versionCode `2`, minimum SDK `26`, asset `Tasks-2.apk`, and SHA256 `4b2bcbb5092c039588ac8ddfa67360ad3ef6cd82d5600947f86b17b3c2efa34a`. Copied APK bytes and digest matched independently. Evidence: `/opt/data/cache/scratch/tasks-release-staging-HoaGX9/`. This reused an earlier APK; no new Android build was performed. Initial inspection lacked Java on PATH; sourcing the documented Android environment resolved it.
- No commit, push, workflow dispatch, release publication, signing-key access, installation or live-data change was performed. Remote GitHub release creation and in-app discovery of that future release remain unverified until an authorized push/run. A fresh release-list read returned no releases.

---

# Authorized Android signing setup — 2026-11-15

- Reused the pre-existing production key; no key rotation or new signing identity. Verified alias `daymark` is a private-key entry, protected directory/file modes are 0700/0600, and its certificate is valid through 2054-04-01.
- Built the current Tasks release with that actual key. `:app:assembleRelease` passed; `apksigner` verified the APK and its certificate matched the existing keystore SHA256 `ef821ed3bfe07fb774f2708edcb300248d5b8f86f9d4765bfa0f31d0b2db47e4`. Actual APK metadata: label `Tasks`, package `com.everyonesoftware.daymark`, versionName/versionCode `2`, non-debuggable. Artifact: `apps/android/app/build/outputs/apk/release/app-release.apk`.
- Uploaded the four required repository Actions secrets to `everyonesoftware/tasks`: `DAYMARK_KEYSTORE_BASE64`, `DAYMARK_KEYSTORE_PASSWORD`, `DAYMARK_KEY_ALIAS`, `DAYMARK_KEY_PASSWORD`. Each exact secret endpoint was read back and its name/update timestamp verified after upload. GitHub does not expose plaintext secret values for read-back. Key/password values were supplied through private process environments or stdin, never command-line literals, output, chat or repository files.
- No commit/push, workflow dispatch, APK installation, GHCR publication or GitHub Release was performed. Remote workflow execution with these secrets remains unverified until the pending workflow is pushed and run. Back up the existing local signing key/password securely; GitHub secrets are not a retrievable backup.

---

# Tasks rebranding verification — 2026-11-15

The current product name is **Tasks**. Active CLI examples use `bin/tasks`, `cmd/tasks` and `/app/tasks`; new APK/artifact examples use `Tasks-`. See `rebranding.md` for unchanged installation, signing, configuration and storage identifiers. No source commit/push, publication, live database change, signing-key access or device install was performed for the rebrand.

- Branding/compatibility regressions were verified RED/GREEN for CLI help and unchanged DB default, export filename, container/artifact naming, web shell/PWA, Android labels/symbols, and release packaging/schema. The existing release packager now accepts the integer commit-count version and emits `Tasks-` APK filenames while retaining `daymark-release.json` and the original Android package ID. The schema also accepts historical APK prefixes.
- `go test -race ./...`, `go vet ./...`, actionlint and `git diff --check` passed. Built the real CGO-free `bin/tasks` with commit-count version `2`; its help identifies Tasks and the new executable name. Independent backend/deployment review found stale server README paths; corrected and rechecked them.
- All 23 web Node tests passed. Real isolated Go API/Chromium acceptance passed with Tasks title, accessible wordmark and sign-in copy; About/server version agreement; task mutation read-back; account isolation; no persistent task/credential data; 320/390/1440px layouts; and offline sign-out. Evidence: `/opt/data/cache/scratch/daymark-go-acceptance-fklPs0/`. The screenshot visibly retains the dark slate/mint Focus + queue layout with the Tasks wordmark.
- Final Android unit tests, debug APK, instrumentation-test APK assembly and lint passed. XML read-back confirmed 37 tests, zero failures/errors/skips. Actual final APK metadata confirmed label `Tasks`, unchanged package `com.everyonesoftware.daymark`, versionName `2`, versionCode `2`. Parent validation caught and corrected an unintended updater metadata filename rename; the legacy-asset regression failed before the correction and passed in the final full Android run.
- Five existing release-packaging tests and three absent/partial release-signing refusal tests passed. Rebranded Android production signing, device instrumentation/install, Docker runtime and remote GitHub publication were not exercised. The Docker daemon remains unavailable. Earlier signed/device evidence below predates the rebrand.

The records below predate the rebrand. Their original Daymark artifact names, binary names, paths, versions and execution results are retained as historical evidence, not claims about the current Tasks build.

---

# Historical CI publishing and commit-count versions — 2026-11-15

No source commit/push, GHCR publication, GitHub Release, signing-secret upload, live database change or device install was performed.

- Workflow actionlint validation passed. New regression tests were verified RED before implementation, then GREEN. The version helper was exercised against merged Git history (all five reachable commits counted) and rejected a shallow clone.
- `go test -race ./...`, `go test ./...` and `go vet ./...` passed. A separate linker-injected test run passed with the real commit count. An actual CGO-free server binary with an isolated scratch database returned `{"status":"ok","version":"2"}` from `/health`.
- All 21 web Node tests passed, including actual-version/error handling. Real isolated API/Chromium acceptance passed, including About matching `/health`, authentication, task mutation read-back, account isolation, no persistent task/credential data, responsive layouts and offline sign-out. Evidence: `/opt/data/cache/scratch/daymark-go-acceptance-DBziyJ/`.
- Android unit tests, debug APK, instrumentation-test APK assembly and lint passed. Unit XML read-back confirmed 37 tests, zero failures/errors/skips. Actual debug APK metadata confirmed package `com.everyonesoftware.daymark`, versionName `2`, versionCode `2`. Runtime configuration probes covered full-history fallback, explicit CI override, valid bounds, invalid values and shallow-history handling.
- The signed release path was exercised using a **disposable test key only**, no production signing material. `:app:assembleRelease` passed with `DAYMARK_VERSION=137`; `apksigner` and `aapt2` verified a signed, non-debuggable APK with the expected package and versionName/versionCode `137`. This is not a production artifact and was not published or installed. The test keystore was removed and the test APK moved outside normal release output to `/opt/data/cache/scratch/daymark-ci-signing-fixture-IKeFKf/Daymark-test-key-only-137.apk`.
- The existing independent release-packaging suite remains unchanged: five tests passed. All three missing/partial release-signing refusal checks also passed.
- Independent review found that an older workflow rerun could roll `latest` backwards despite serialization. The correction gates `latest` on the current remote `main` SHA while preserving numbered tags. A real local Git regression test was verified RED/GREEN for current-head promotion, old-run replay, and lookup failure. Final race/vet, shell syntax and actionlint checks passed after the correction.
- Docker build/runtime remains **unverified**: the installed Docker CLI has no reachable daemon; rendered Compose integration skipped because the Compose plugin is unavailable. Local binary/static deployment checks do not substitute for a Docker build.
- The repository currently has no configured Actions secrets. Production Android CI needs the four documented signing secrets before it can complete. No remote workflow run or GHCR permission/public-pull behavior was exercised because these changes have not been pushed.

See `ci-publishing.md` for workflow triggers, image tags, APK artifact policy, version semantics and setup prerequisites. Earlier migration/device/signing evidence below predates these version changes.

---

# Historical Go server migration verification — 2026-11-15

The Python backend, backend tests and Python browser runners have been replaced by Go and a self-contained Node/Chromium acceptance runner. The HTML/CSS/JS UI and native Android client are unchanged. No live database, user account, personal device, commit, push or release was changed.

## Migration gates at that verification

| Gate | Actual result |
|---|---|
| Go server | 34 tests passed |
| Go CLI, real listener, TLS, healthcheck routing and graceful shutdown | 14 passing test results, including four healthcheck subcases |
| Go deployment/configuration | 4 tests passed, including rendered standalone Compose configuration |
| Go race detector | All three packages passed |
| Go vet | Passed |
| Final compiler and CGO-free binary | `bin/daymark`, Go 1.26.11, `CGO_ENABLED=0` verified with `go version -m` |
| Vulnerability scan | No vulnerabilities found using the final project toolchain |
| Web Node behavior | 19 passed |
| Web ES module syntax | Passed |
| Android JVM | 37 passed; zero failures/errors/skips, verified from XML |
| Android debug/app-test assembly and lint | BUILD SUCCESSFUL |
| Unchanged Android release packager/signing-refusal checks | 5 packaging and 3 signing-refusal tests passed |
| Docker image build/run | Not verified: Docker daemon unavailable |

The minimum compiler and Docker build image were raised to Go 1.26.11 after scanning with the actual host Go 1.25.14 exposed standard-library advisories. Scanning by `go run` alone initially selected a newer scanner toolchain; the final scan explicitly checked the project's final compiler. The indirect `golang.org/x/sys` dependency was also raised to its advisory-fixed version.

Go tests cover database migration and explicit legacy adoption, Python-compatible hashes/schema, owner-scoped reads and mutations/export, password reset/session races, recurrence at calendar boundaries, same-day completion history, JSON validation, request size/deadlines, rate limiting, TLS/Host/Origin policy, and static-path/database-sidecar/symlink protections. HTTP requests rejected by Go's parser before dispatch may have Go's native HTTP 400 response instead of JSON; application-handler errors remain JSON.

Independent review found a healthcheck regression: dialing the public hostname introduced external DNS/hairpin/published-port dependencies. The corrected Compose healthcheck dials `127.0.0.1:8787` through `--connect-address`, while the HTTPS URL still supplies the configured hostname for certificate verification, SNI and HTTP Host. Real TLS regressions verify an unresolvable `.invalid` hostname works through loopback, wrong CA/hostname fail, and published port `9443` does not affect internal health. Independent re-review approved the correction with no security concerns, logic errors or remaining suggestions; its focused CLI/deployment, race and vet checks passed.

## Real clients against the Go API

- `node tests/web/api-smoke.mjs` passed on the final Go 1.26.11 build: actual Chromium cookies/login, task creation, completion/undo independently read back, failed account replacement preserving the session, confirmed account switching/isolation, XSS escaping, no browser task/credential persistence, 320/390/1440px layout, offline sign-out/reload suppression, explicit re-login and server logout revocation. Final report and screenshot: `/opt/data/cache/scratch/daymark-go-acceptance-9eAQy6/`.
- The desktop-facing `http://hermesdan.tail1a7c8f.ts.net:8793/` served the actual UI and `/health` returned `ok` / `0.2.0` during an explicitly insecure, temporary encrypted-tailnet development probe. This is not a production HTTPS deployment. The temporary server has been stopped.
- On the owned `daymark-validation-api29` / `emulator-5584`, installed the freshly built debug APK, used the actual first-install sign-in form against a disposable Go database via `adb reverse`, rendered `Go native acceptance task`, and tapped **Mark done**. Both native UI and an independent API read confirmed `1 of 1 complete`. Screenshot/UI evidence: `/opt/data/cache/scratch/daymark-native-go-51CM8g/`. The server and emulator were stopped afterward. This native smoke used the final HTTP/store implementation but preceded the compiler security upgrade from Go 1.25.14 to 1.26.11 and healthcheck-only CLI correction; final CLI/TLS, race and Chromium checks were rerun afterward. Full native instrumentation and a production-signed release were not rerun for this backend migration.

The separate Android release-packaging helper and its Python tests remain unchanged; Python is no longer required to build, run, provision or browser-test the web/API server. Back up an existing database using SQLite's backup API before any real deployment. Live cutover and Docker runtime validation remain unperformed.

---

# Historical Daymark v0.2.0 verification (Python backend)

Executed on 2026-11-14. No user database/accounts, personal device, source commits, pushes, or GitHub releases were changed.

## Automated gates

| Gate | Actual result |
|---|---|
| Python server | 40 passed; ResourceWarnings treated as errors |
| Release manifest packager | 5 passed; includes actual `aapt2` minimum-SDK spelling |
| Web Node behavior | 19 passed |
| Web ES-module syntax | app/auth/state checks passed |
| Android JVM | 30 passed, zero failures/errors/skips (XML read-back) |
| Android native API29 | 12 passed, zero failures/errors/skips (XML read-back) |
| Android debug/app-test assembly and lint | BUILD SUCCESSFUL; no lint errors, dependency/KTX warnings remain |
| Release-signing refusal probes | 3 passed: missing/partial configuration is refused without echoing values |
| Production-signed release assembly | BUILD SUCCESSFUL; actual SDK metadata and APK signature verified |

Server tests include real two-user HTTP isolation across routes/export, revocation/expiry/reset races, rate limiting, legacy adoption, verified HTTPS, Origin/Host checks, protected database/sidecars/static paths, finite reads, surrogate rejection, and recurrence/history behavior.

## Real browser/API acceptance

`tests/web/api-smoke.py` ran real Chromium form submissions and HTTP requests against a fresh scratch SQLite database, not mocked fetch responses. Verified:

- First-login fields and actual HttpOnly-cookie session restoration.
- Server-provided task rendering and HTML-looking task strings displayed safely.
- Completion and undo, each checked by a separate authoritative API read.
- Failed proposed credentials retaining the working session.
- Confirmed account switching and absence of the previous user's tasks.
- Browser task creation checked by a separate authoritative API read.
- No horizontal overflow at 320, 390, and 1440 pixels.
- Offline logout warning, reload suppression despite a surviving cookie, explicit re-login, and successful remote logout returning 401 afterward.
- No browser task/password/token persistence; the signed-out marker is non-sensitive.

The final runner exited 0. Its disposable server is stopped. Reproduction instructions and the loopback-only fixture server are in `tests/web/README.md`; the fixture cannot accept a user database path.

## Real Android/API acceptance

On the task-owned `daymark-validation-api29` / `emulator-5584` only:

1. Installed a production-signed 0.2.0/build2 APK.
2. Entered the isolated Python server URL and disposable account in the actual first-install form.
3. Rendered the same server-owned tasks used by browser acceptance.
4. Tapped native **Mark done**; a separate API read confirmed progress changed to 1 of 4.
5. Settings displayed the PackageManager version/build and a real GitHub **No published releases yet** response.

This production API smoke preceded the final update-status-only correction (sign-in must not fabricate a cancelled download). That correction was first reproduced by a failing native assertion, then all 12 native tests and 30 JVM tests passed, and the final signed APK was rebuilt and reverified. The task-owned emulator was stopped afterward; no other emulator/device was used.

## Final deliverable

- APK: `dist/android/v0.2.0/Daymark-0.2.0-2.apk`
- Manifest: `dist/android/v0.2.0/daymark-release.json`
- Package: `com.everyonesoftware.daymark`
- Version/build: `0.2.0` / `2`; minimum SDK `26`
- Actual APK SHA256: `081ed3b13865ac0400d7175ce8bc99fe2bc25a488677c8f9a2334eeffe621446`
- Actual signing certificate SHA256: `ef821ed3bfe07fb774f2708edcb300248d5b8f86f9d4765bfa0f31d0b2db47e4`
- `apksigner verify`: Verifies; APK Signature Scheme v2 true, one signer.
- Manifest checksum was independently recomputed from the copied APK bytes and matched.
- Private signing material remains outside Git and is not included in deliverables.

## Review

The initial independent review reproduced offline logout being undone by reload. It is fixed with a non-sensitive persistent signed-out marker; the regression failed before implementation and passed afterward, including real Chromium reload acceptance. Final independent re-review passed with no security concerns or logic errors. Its separate probe verified three reloads blocked cookie restoration without requests, three failed explicit logins retained suppression, and successful explicit login restored access. The suggested permanent failed-login/reload regression was incorporated into the existing Node test and rerun successfully.

Live GitHub probing also exposed an invalid binary Accept header on release metadata (HTTP 415). Metadata now requests GitHub JSON, while assets retain binary media. Two JVM regressions cover the request headers, and the production app's live check reached the correct no-release state.

## Deployment and explicit limits

- Production HTTPS/reverse-proxy/certificate deployment and a real user account are not provisioned by this feature build. See root `README.md` and `services/server/README.md` for administrator setup. There are no default credentials or seeded live tasks.
- GitHub repository was public and latest stable release returned 404 at verification. No release was fabricated or published. The app can check actual release availability, but a future newer GitHub APK download, modern install-source permission round trip, and in-place system-installer upgrade remain unverified end to end.
- Update policy, malformed/hostile assets, digest/package/version/signer rejection, cancellation cleanup, and installer gating have fixture/unit coverage; that is not a claim of a completed real newer-release installation.
- Debug and production APKs have different signing identities; a production APK cannot upgrade a debug-signed install in place.
- Offline sign-out can block local automatic restoration but cannot guarantee remote revocation while disconnected. The UI says so.
- Login limiting is in-memory and resets on restart; a local reverse proxy shares a limiter bucket. Expired session rows are not automatically pruned.
- This is not an offline task app: tasks/history persist on the server, and clients clear task access on disconnection.

## Initial-commit verification follow-up

Before the authorized initial commit, server (40), release packager (5), signing-refusal (3), deployment (2), and web Node (19) tests passed again, as did web syntax checks and real Chromium/API acceptance against a fresh disposable database. Signing probes required sourcing the Android environment. The host lacked the Docker Compose plugin; deployment tests passed using the official standalone Compose v5.7.1 binary after verifying its release checksum.

Independent pre-commit review found that separate Android session-field commits could pair a replacement endpoint with an old token after interruption. A failing regression reproduced that mixed session. The fix stores endpoint, username, and token in one authenticated encrypted envelope with one checked preference commit and rejects legacy split records. All 37 JVM tests now pass, including nine session-storage tests; debug APK/test APK assembly and lint pass. Lint retains 14 warnings and no errors.

The storage fix was tested with simulated write interruptions and real JVM AES-GCM authentication, not device power loss or a new Android Keystore runtime run. Earlier native/API29 and production-signed APK evidence above predates this final storage change; the listed signed artifact is not a build of the final committed source. No replacement signed release or GitHub release was produced by this commit follow-up.
