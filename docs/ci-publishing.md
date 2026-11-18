# Tasks CI publishing and commit-count versions

`.github/workflows/publish.yml` runs on pushes to `main`, or manually on `main`.
It tests the server/web first, then independently publishes the container and builds
the changed Android/Windows platforms. Application selection compares against each
platform's verified publication source, not merely the previous push, so a failed
build remains eligible on a later push. Unchanged binaries remain in their original
releases; they are not rebuilt, copied or relabeled. One release job requires
successful validation and success or an intentional skip from each application job:
Android tests/lint/signing/APK verification and the native Windows build/installer
lifecycle gate run when selected. Only then does it create a stable GitHub Release
with the selected client outputs. It does not deploy a server, modify live databases, or install on personal
devices. The installer gate uses only a disposable hosted Windows runner.

## Shared version

`bash scripts/build-version.sh` computes `git rev-list --count HEAD` from a full
checkout. The version includes merged commits, not just first-parent history; it
is not the Actions run number. Shallow history and counts outside Android's
positive versionCode range are rejected. Keep `main` history append-only: rewriting
history can reuse or decrease versions. Separate histories can also have equal
counts, so the container's revision label records the exact source commit.

For count `N`:

- Container tags: `ghcr.io/everyonesoftware/tasks:N` and `:latest`.
- OCI image version label and unauthenticated server `/health` version: `N`.
- Android `versionCode`: integer `N`; `versionName`: string `N`.
- Actions artifact: `Tasks-android-N`, containing `Tasks-N.apk`, `SHA256SUMS`, primary
  `tasks-release.json` and its byte-identical `daymark-release.json` compatibility alias.
- Windows executable version: `0.1.N`, file version `0.1.N.0`, with the exact source
  SHA in its informational version. Windows requires `N <= 65534` because .NET
  assembly-version components have a tighter bound than Android version codes.
- Windows release assets: `Tasks-Windows-N-Setup.exe` and its `.sha256` legacy
  filename-compatibility alias; `TasksWindows-win-x64-Setup.exe` and its `.sha256`; genuine
  `TasksWindows-0.1.N-win-x64-full.nupkg` and `releases.win-x64.json`. Both setup
  aliases have identical guarded bytes. Sidecars hash those exact installer bytes
  and do not replace Android's existing `SHA256SUMS`.
- GitHub Release: tag `vN`, title `Tasks N`, targeting the exact build commit, with
  the selected platforms' verified files attached, plus generated notes.

Publishers are serialized, and `latest` is added only if the build SHA still matches
the remote `main` head when choosing tags. Replaying an older workflow keeps its
numbered tag without rolling `latest` back. A failed remote-head lookup fails closed.

Android uses `DAYMARK_VERSION` when explicitly supplied (as CI does), otherwise it
counts local full Git history. An unversioned direct Go or Docker build reports
`dev`, not a fabricated release version. To build locally with the shared version:

```sh
version="$(bash scripts/build-version.sh)"
CGO_ENABLED=0 go build -trimpath \
  -ldflags="-s -w -X github.com/everyonesoftware/tasks/services/server.Version=$version" \
  -o bin/tasks ./cmd/tasks
docker build --build-arg VERSION="$version" -t "ghcr.io/everyonesoftware/tasks:$version" .
```

## GHCR authorization

The container job uses the repository's `GITHUB_TOKEN` with `contents: read` and
`packages: write`; no registry PAT is required. The Android job has no package-write
permission. Actions are pinned to full commit SHAs. If the GHCR package already
exists, ensure this repository has permission to write it. Configure package
visibility separately if anonymous pulls are wanted; this workflow does not change
organization/package visibility settings. The image includes both the Go server
and web assets and retains its existing non-root runtime and private-data exclusions.

## Android signing prerequisites

Configure these repository Actions secrets before expecting a successful Android
release build:

| Secret | Value |
|---|---|
| `DAYMARK_KEYSTORE_BASE64` | Base64 of the **existing** production PKCS12 keystore |
| `DAYMARK_KEYSTORE_PASSWORD` | Existing keystore password |
| `DAYMARK_KEY_ALIAS` | Existing alias (`daymark`) |
| `DAYMARK_KEY_PASSWORD` | Existing key password |

Use a secure secret manager or the GitHub secrets UI/CLI; never paste private keys
or passwords into chat or commit them. See `android-releases.md` for signing-key
continuity. The workflow fails explicitly if signing secrets are missing; it never
substitutes a debug APK, an unsigned APK, or a newly generated signing identity.
The decoded keystore exists only in the runner's private temporary directory and
is removed on success/failure. Only the APK, checksum and updater manifest are
uploaded as workflow artifacts, retained for 30 days, and as release assets.
The build verifies the actual APK signature, package name, version name,
version code and non-debuggable status before uploading it. The manifest records
the verified package/version, minimum SDK read from the APK and actual APK SHA256.

## Combined Android and Windows GitHub Release

Only the combined release job receives `contents: write`; its release step authenticates
with the repository's `GITHUB_TOKEN`, without a separate PAT. Releases are public
stable releases, not drafts or prereleases, and remain after the workflow artifact
expires. The existing standalone packaging helper remains available for manual
release preparation; CI stages its own matching manifest without a Python dependency.

The release becomes `latest` only when it includes a newly verified Android APK
and the build SHA matches remote `main` at publication time. Windows-only releases
remain stable numbered releases with `latest=false`; existing Android clients can
continue consuming the previous APK-compatible Latest release. Older reruns can create their numbered release without replacing
`latest`; a failed remote-head lookup prevents release creation. The job resolves
any existing `vN` tag (including annotated tags) to its commit and rejects a
different build SHA. It checks the tag again after release creation. If a release
for `vN` already exists, creation fails rather than replacing its APK or changing
its tag. Failed
asset uploads can leave a draft requiring explicit operator recovery; reruns do not
silently overwrite an existing release. After creation, the job reads back that
exact release and requires all selected uploaded assets on a non-draft, non-prerelease
release before reporting success.

The manifest enables the Android updater to discover the release. Download and
installation still require explicit user action and Android installer confirmation;
publishing never installs an update automatically. Container publication is
independent: a container-job failure does not block a successful combined application release.

## Unsigned Windows installer

The Windows job uses the native Windows 2025 build environment, the pinned .NET SDK
from `apps/windows/global.json`, Velopack **1.2.161** from the local tool manifest,
and the runner's Inno Setup compiler solely for the unregistered transition guard.
It runs the Windows tests (including the actual pinned updater-source tests),
publishes the self-contained x64 WinUI client, verifies its native runtime/merged
PRI and source-bound file version, packs and validates the genuine full nupkg/feed,
then embeds the genuine setup in the guard. Neither public setup alias bypasses
the guard; no second Inno application installation or registration is created.
It never packages the Linux compile-only library. Missing native payloads, mixed-case
duplicate files, linked files, private data, wrong architectures and version/source
mismatches fail closed. No Windows signing certificate or signing secret is needed;
unsigned distribution is explicit and Windows may display a SmartScreen warning.

Installation is per-user, without administrator rights, under
`%LOCALAPPDATA%\Programs\Tasks`, with Velopack's `current` application directory,
`Update.exe`, a Start menu shortcut and `TasksWindows` uninstall registration.
The old Inno GUID is retained for detection: existing installations are refused
and require a one-time manual uninstall before setup, rather than an unverified
automatic migration or side-by-side installation. Uninstall does not delete the
separate protected user-session directory or contact the server; task data remains
server-only. Existing Velopack installations update through Settings, not repeated
setup execution. There is no launch-at-sign-in or automatic startup apply. Settings
uses explicit Check → Download with progress → Restart and install.

Windows-only releases must remain `latest=false` because existing Android clients
consume GitHub Latest. The old browser-only Windows checker also uses Latest, so
its compatible filename cannot discover a newer Windows-only release automatically.
Existing Inno users must download that release manually for the one-time transition;
after installation, Velopack's Windows-specific feed selection does not depend on Latest.

Before publishing the installer artifact, CI installs it into an isolated runner-temp
directory, launches the **installed** executable, requires a responsive rendered native
window and screenshot, closes it, and uninstalls it. Registration/shortcut/install
removal is checked independently. An existing Tasks install or user profile makes the
gate refuse to run; it does not clear personal data. A bounded failed gate blocks the
release, and its diagnostics are retained with `if: always()` separately from release
assets. Neither a surviving process nor a Linux source test counts as native acceptance.

Local Windows commands, installation limits and checks are in
`apps/windows/README.md`. Adding these files locally does not run GitHub Actions or
publish a release: an authorized push is still required. After that run, inspect the
native screenshot and exact release assets before describing an installer as verified
and available. Existing releases are never overwritten or backfilled automatically.
