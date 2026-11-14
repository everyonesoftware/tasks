# Connection, onboarding, and update mockup

Artifact: `daymark-settings-v1.html`. This is a standalone design preview, not an authentication or updater implementation. The existing Focus + queue task UI is preserved; these screens add onboarding and Settings.

## Screens and interactions

1. **First launch**: require server URL, username, and password before opening tasks. In this mockup, click **Use example credentials**, then **Sign in**. Password fields are deliberately read-only and use a fixed demo value; never enter real credentials.
2. **Settings / Connection**: show server, account, connection state, and an **Edit connection** action. Editing requires re-entering a password; **Test & save** only replaces the saved connection after success. Changing server/account asks for confirmation. Failed replacement leaves the previous connection unchanged. Sign-out removes the session on this device, not server tasks.
3. **Settings / App updates**: installed version/build, check-at-launch switch, manual check, repository source, available-version status, and review action. The controls above the mockup can preview up-to-date, no releases, GitHub unavailable, or an illustrative update.
4. **App update**: release notes, download/progress/cancel, ready-to-install, Android installer confirmation, and example post-install version readback. The phone's primary action stays above bottom navigation. No actual package is downloaded or installed.

Desktop + phone / desktop-only / phone-only viewing is included. The phone uses fixed Pixel 10 screen/body proportions, scales the entire UI, and defaults to 50% (saved user adjustments are retained). Larger phone text remains independent of desktop typography.

## Data and credential model for future implementation

- Task records and completion history are server-only. A device holds connection information and a secure authenticated session, not a local task database. A lost connection blocks task access/changes; never falsely display successful offline writes.
- This intentionally changes the initial v0.1 assumption: the existing unauthenticated API and persistent read-only task caches do not implement the new requirement. Add real server authentication and remove persistent task payload caching before describing these screens as functional.
- Exchange username/password for a revocable server session over HTTPS. Do not persist raw passwords in localStorage, logs, plain preferences, or the artifact. Use appropriate platform-protected session storage on Android. Passwords are not displayed in the Connection review panel; the user re-enters one when updating sign-in details.
- Validate URL/TLS and credentials before swapping sessions. Never disable certificate validation to make a connection succeed. Changing server/account must not transfer, merge, erase, or upload tasks from the previous connection.

## GitHub update model for future implementation

Repository: `everyonesoftware/tasks`.

The repository had **no published releases** when checked for this mockup. Installed **0.1.0 / build 1** corresponds to the development APK already built. **0.2.0 / build 2** and its release notes are illustrative, not an actual release.

Before a production updater:
- Define a stable release channel and Android APK asset convention.
- Compare numeric Android version codes; exclude drafts/prereleases unless explicitly enabled.
- Verify the downloaded package identity and signing certificate; preserve signing continuity across releases. Do not offer arbitrary release assets as app updates.
- Never bundle a personal GitHub token in the app. If repository visibility requires authorization, resolve that through an explicit secure release-distribution design.
- Request any Android install-source permission and hand off to the system installer with explicit user confirmation. Do not imply silent installation.
- Failed checks/downloads/cancellation must leave the installed app and server session intact.

## Review boundaries

No production Android, web, server, API-contract, or GitHub release changes were made as part of this mockup task. No commits/pushes were requested. The preview saves only the viewer mode and phone-scale preference; connection fields and simulated app state are in memory and reset on reload.
