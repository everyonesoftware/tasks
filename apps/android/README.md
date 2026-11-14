# Daymark Android

Native Kotlin / Jetpack Compose. Package `com.everyonesoftware.daymark`; **0.2.0, build 2**. Minimum API 26, target/compile API 36.

## Build and verification

```sh
cd /opt/data/code/tasks/apps/android
source /opt/data/tools/android-env.sh
bash gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest :app:lintDebug --console=plain --max-workers=2 -Dorg.gradle.jvmargs='-Xmx768m -XX:MaxMetaspaceSize=512m'
python3 -m unittest discover -s ../../tests/android -p 'test_release_signing.py' -v
# Only after verifying the emulator is owned by this task:
ANDROID_SERIAL=emulator-5584 bash gradlew :app:connectedDebugAndroidTest --console=plain --max-workers=2 -Dorg.gradle.jvmargs='-Xmx768m -XX:MaxMetaspaceSize=512m'
```

Serialize Gradle invocations. Never use another project's emulator or a personal device. `emulator-5582` is not ours. API29 `daymark-validation-api29` on port 5584 completed native tests using software acceleration; API35 had previously failed in the emulator infrastructure.

Artifacts:
- Debug app: `app/build/outputs/apk/debug/app-debug.apk`
- Instrumentation: `app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`
- Unit XML: `app/build/test-results/testDebugUnitTest/TEST-*.xml`
- Instrumentation XML: `app/build/outputs/androidTest-results/connected/debug/`
- Lint XML/HTML: `app/build/reports/lint-results-debug.{xml,html}`
- Execution logs: `feature-build-gates.log`, `connected-feature-tests.log`, `release-signing-tests.log`; `tdd-*-red.log` / `tdd-*-green.log` capture feature slices. Earlier v0.1 cache-related logs are historical and superseded.

## Connection and privacy

First launch has blank endpoint/username/password inputs. Authenticate and verify the proposed session before replacing a working connection. Account/server switches need confirmation. Passwords are memory-only and cleared from form state on submission; they are never persisted. The production API client attaches the Bearer session only to the configured server, disables redirects, and uses normal TLS certificate validation.

Persisted preferences contain only endpoint, canonical username, Keystore AES-GCM encrypted opaque token, and the non-sensitive launch-check preference. Each token encryption uses a random IV. Legacy task caches, focus/order entries, old base URL and unexpected preferences are removed. Task payloads, editor drafts and focus ordering are memory-only; there is no offline list or write queue. Network/write failure clears displayed task state. Session expiry returns to sign-in. Sign-out clears local state immediately and attempts remote revocation, reporting when revocation cannot be confirmed. Backup/transfer are disabled.

Use HTTPS by default. Localhost, 127.0.0.1 and emulator-host 10.0.2.2 support local development HTTP. Exact `hermesdan.tail1a7c8f.ts.net` HTTP is debug-only, includes a development warning, and is not available in release network security configuration. No seeded tasks or saved default server.

## Settings and updates

Connection and App updates panels preserve the Focus + queue UI and readable phone type. Installed version/build comes from PackageManager, refreshed on resume. Updates use only the public `everyonesoftware/tasks` latest-stable release and actual `daymark-release.json` asset. No GitHub credentials and no backend session sharing. No release, failed check, current and newer states are distinct. Checking at launch is optional; download and installation are always explicit actions. Review shows the actual release notes and installed/available builds.

Downloads run on IO with progress, cancellation, size/time limits and atomic staging in app-private `cache/updates`. Initial URLs are restricted to the expected repository/API paths; redirects are capped and restricted to official GitHub release asset hosts. The manifest, SHA256, package, exact newer version, compatible minSdk, and installed signing certificate are checked before offering installation and rechecked before opening the installer. Cancel/failure/sign-out removes staged APKs. FileProvider exposes only the updates cache directory. Android install-source permission and the system installer remain user-controlled; launching either is not claimed as successful installation.

## Production signing

The release build reads exactly these environment variables, all-or-none:

- `DAYMARK_KEYSTORE_PATH`
- `DAYMARK_KEYSTORE_PASSWORD`
- `DAYMARK_KEY_ALIAS`
- `DAYMARK_KEY_PASSWORD`

Secrets/key material must be provisioned outside Git and loaded privately. Do not print them, put them in Gradle properties, upload them, or generate a replacement key for an existing installation. Release signing is configured only when all four are nonblank. Release assemble/package/bundle tasks refuse to run without signing configuration; partial configuration fails before task execution. Debug builds do not need release secrets. The parent integration task owns actual signed release assembly and delivery; this feature task neither generated/read a production key nor published any release.

## Test scope and limits

30 JVM tests cover API parsing/mutations, no offline payload persistence, auth/redirect/rate-limit policy, preserved failed connection replacement, logout/expiry primitives, storage migration/encryption abstraction, manifest/URL/APK identity policies, 404/failed/current/newer checks, cancellation/digest failure cleanup, installer gating, and correct JSON-versus-binary GitHub request headers. Three Python Gradle probes check absent/partial release signing rejection.

12 API29 native tests cover first-install fields, explicit login, switch confirmation, two settings panels, installed version display, separate update review/user download action, no-release UI, Focus/queue actions, task form validation, offline write disabling, real loopback HTTP login/Bearer/session failure/expiry with the actual Activity and Keystore, and randomized encryption/tamper rejection. All data/accounts are isolated test fixtures. These tests do not mutate a user's server or device.

Parent acceptance additionally installed the production-signed 0.2.0/build2 APK on the task-owned API29 emulator, entered a disposable account in the first-launch form, rendered tasks from the actual Python server, and verified a native completion by reading back server state. Settings displayed the PackageManager version and the live GitHub no-releases result. A later native regression verifies that signing in does not invent a cancelled download or cancel an unrelated update check.

There is no published newer APK installed via the real system installer. Public release download/install, source-permission round-trip on modern Android, and a production-signed upgrade still require device validation. Pinned dependency notices and minor KTX suggestions remain lint warnings, not suppressed errors. See `docs/verification.md` at the repository root for final artifact checksums and scope.
