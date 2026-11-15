# Tasks rebranding and compatibility

**Tasks** is the product name formerly shown as Daymark. This is a branding change,
not a replacement installation identity. Current CLI paths are `bin/tasks`,
`cmd/tasks` and `/app/tasks`. New release APK names and Actions artifact names use
the `Tasks-` prefix; historical verification records retain their original names.

The following technical compatibility identifiers remain unchanged:

- Android application ID/package: `com.everyonesoftware.daymark`.
- Existing database locations, including `.data/daymark.sqlite3` and
  `/data/daymark.sqlite3`; existing task, account and history storage is retained.
- Legacy `DAYMARK_*` environment variables and CI secrets retain their names,
  including version, backend port and signing configuration, except that
  `DAYMARK_HOST` has been renamed to `TASKS_HOST`. Update existing deployment
  environment entries; the old hostname variable is no longer read.
- `daymark_session` and existing cookie, preference, session and storage keys.
- Updater metadata asset: `daymark-release.json`.
- Existing production signing identity, including the external keystore path
  `/opt/data/state/daymark/signing/daymark-release.p12`, its protected password
  file `/opt/data/state/daymark/signing/keystore-password` and key alias `daymark`.

No data migration, app-ID change, signing-key rotation or storage reset is required
by the rebrand. Keep using the existing database and production signing key; do
not reinstall, clear app data or create a new identity merely to change the name.
Normal signature/version checks and explicit Android installation confirmation
still apply to updates. Historical mockup filenames and validation evidence are
not renamed to imply that an old artifact was built or verified as Tasks.