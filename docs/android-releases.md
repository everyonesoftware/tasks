# Tasks Android signing and GitHub release assets

The app checks stable releases in `everyonesoftware/tasks`. New releases contain the signed Android APK and primary `tasks-release.json` matching `contracts/android-release.schema.json`, plus a byte-identical `daymark-release.json` compatibility alias for installed clients. New clients prefer the Tasks name and accept legacy-only historical releases only when it is absent; invalid or failed primary metadata is an error.

For the main-branch container/Android workflow, commit-count versioning and required GitHub Actions signing secrets, see `ci-publishing.md`. Successful verified Android builds automatically publish a stable `vN` GitHub Release with `Tasks-N.apk`, `tasks-release.json`, its legacy alias, and `SHA256SUMS`. The manual packaging examples below describe the historical feature build, not the current commit-count build.

Query GitHub for actual published releases. Do not substitute an illustrative mockup version or pretend a new release is available.

## Signing continuity

A persistent signing key was provisioned outside Git on this build host:

```text
/opt/data/state/daymark/signing/daymark-release.p12
/opt/data/state/daymark/signing/keystore-password
```

The alias is `daymark`. These paths, the signing identity and the `com.everyonesoftware.daymark` app ID are unchanged by the Tasks rebrand; see `rebranding.md`. The private directory is mode 0700 and both files are mode 0600. Do not print, commit, attach, or upload these files in a chat. Back them up securely outside the repository/container lifecycle. Losing the key prevents ordinary in-place updates of installations signed with it. The key is a local Android code-signing key, not a server TLS certificate.

With explicit authorization, the existing key was verified and configured as repository Actions secrets in `everyonesoftware/tasks` on 2026-11-15: `DAYMARK_KEYSTORE_BASE64`, `DAYMARK_KEYSTORE_PASSWORD`, `DAYMARK_KEY_ALIAS`, and `DAYMARK_KEY_PASSWORD`. GitHub metadata read-back confirmed all four secrets exist; GitHub does not return their plaintext values. No replacement key was generated. The public signing-certificate SHA256 is `EF:82:1E:D3:BF:E0:7F:B7:74:F2:70:8E:DC:B3:00:24:8D:5B:8F:86:F9:D4:76:5B:FA:0F:31:D0:B2:DB:47:E4`.

Gradle release signing uses these environment variables:

- `DAYMARK_KEYSTORE_PATH`
- `DAYMARK_KEYSTORE_PASSWORD`
- `DAYMARK_KEY_ALIAS`
- `DAYMARK_KEY_PASSWORD`

Load passwords privately from a protected file or secret manager, never command-line literals. Release builds must refuse incomplete/missing signing configuration rather than silently deliver an unsigned APK.

The debug APK uses a different development certificate. Android cannot update a debug installation with this production signing key. For the first production install, remove the development app if Android reports a signature mismatch. Task records remain on the server; sign in again after reinstalling. Future production APKs must use the same persistent production signing identity.

## Create release assets

After a signed release APK has been built and verified, run from the project root with the Android SDK environment configured:

```sh
python3 scripts/create_android_release.py \
  --apk apps/android/app/build/outputs/apk/release/app-release.apk \
  --out dist/android/v0.2.0
```

The tool reads package identity, version name/code, and minimum SDK using the Android SDK's `aapt2`; it computes the APK's actual SHA256 and copies the exact artifact into the output directory. It does not guess values from a tag, sign an APK, or upload/publish anything. Debuggable APKs are refused unless `--allow-debug` is explicitly used for development verification. Do not publish development packages as production releases.

Output names follow this convention:

```text
Tasks-0.2.0-2.apk
tasks-release.json
daymark-release.json
```

Upload those three output files to the same non-draft, non-prerelease GitHub release, using the matching version tag. Keep signing-key continuity for every future build, and monotonically increase Android versionCode. A GitHub Actions runner must be explicitly provisioned with the same signing identity through a secure secret store before it can produce compatible release APKs; do not let CI generate a new random signing key per build.

The configured main-branch workflow publishes verified Android releases automatically. Pushing source, manually publishing releases, and configuring repository secrets still require authorization. No GitHub release or signing-secret upload is performed automatically by the standalone packaging tool.

## Updater checks

The app must compare versionCode, require the expected application package, validate release/download URL origins, validate manifest SHA256, inspect the APK's actual version and signer, and require the user's Android installation confirmation. Fetching release metadata or starting the installer is not proof that an update was installed: PackageManager version readback on resume is authoritative.

Fixture-based tests may use deliberately small non-installable byte strings and fake metadata to test the packaging/parser seams. Those fixtures are not release artifacts; only actual `aapt2`/APK signing verification can establish real package identity and installability.
