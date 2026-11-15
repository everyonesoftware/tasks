# Tasks CI publishing and commit-count versions

`.github/workflows/publish.yml` runs on pushes to `main`, or manually on `main`.
It tests the server/web first, then independently publishes the container and builds
Android. After Android tests, lint, signing, APK verification and artifact upload
succeed, it publishes a stable GitHub Release. It does not deploy a server, modify
live databases, or install an APK.

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
- Actions artifact: `Tasks-android-N`, containing `Tasks-N.apk`, `SHA256SUMS`, and
  `daymark-release.json`.
- GitHub Release: tag `vN`, title `Tasks N`, targeting the exact build commit, with
  those same three files attached and automatically generated release notes.

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

## Android GitHub Releases

Only the Android job receives `contents: write`; its release step authenticates
with the repository's `GITHUB_TOKEN`, without a separate PAT. Releases are public
stable releases, not drafts or prereleases, and remain after the workflow artifact
expires. The existing standalone packaging helper remains available for manual
release preparation; CI stages its own matching manifest without a Python dependency.

The release becomes `latest` only when the build SHA matches remote `main` at
publication time. Older reruns can create their numbered release without replacing
`latest`; a failed remote-head lookup prevents release creation. The job resolves
any existing `vN` tag (including annotated tags) to its commit and rejects a
different build SHA. It checks the tag again after release creation. If a release
for `vN` already exists, creation fails rather than replacing its APK or changing
its tag. Failed
asset uploads can leave a draft requiring explicit operator recovery; reruns do not
silently overwrite an existing release. After creation, the job reads back that
exact release and requires all three uploaded assets on a non-draft, non-prerelease
release before reporting success.

The manifest enables the Android updater to discover the release. Download and
installation still require explicit user action and Android installer confirmation;
publishing never installs an update automatically. Container publication is
independent: a container-job failure does not block a successful Android release.
