# Current downloads

The root README and newest stable numeric Tasks release share a generated **Current downloads** table. Android and Windows are resolved independently from verified publications, not from GitHub Latest. Windows-only releases deliberately do not replace Android's Latest release. Unchanged installers retain their original URL, version and source identity; table refresh never rebuilds, copies or relabels binaries.

## Published inventory

`scripts/current-downloads.mjs` reuses the publication verification in `scripts/selective-builds.mjs`: bounded release/asset discovery, stable `vN` tags, exact source/tag identity, full Git history, commit-count versions and platform manifests. Android prefers `tasks-release.json` and supports legacy-only `daymark-release.json` history. A malformed selected manifest fails closed. Windows requires the genuine full package/feed and current guarded setup/checksum, not retired installer aliases.

- **Android:** release-key-signed APK and SHA-256 inventory; requires a separately provisioned Tasks server/account.
- **Windows x64:** unsigned installer and SHA-256 sidecar; Windows may show unknown-publisher/SmartScreen warnings. Existing Inno installations require the documented one-time manual transition. See [Windows installation limits](ci-publishing.md#unsigned-windows-installer).
- **Web/server:** the browser client is served by the private Tasks server. The table links to deployment instructions, not an invented downloadable web installer or an unverified current container version.

Discovery verifies publication metadata, not new native runtime acceptance. Publishers remain responsible for actual artifact verification. The table is not an in-app update feed and does not change signing, package or installation identities.

## Read-only preview

With authenticated `gh` and a full checkout:

```sh
node scripts/current-downloads.mjs --repository everyonesoftware/tasks --output-directory "$TMPDIR/tasks-download-preview"
```

Review the generated README, release notes and inventory. Preview writes only local artifacts and preserves local README prose outside `<!-- current-downloads:start -->` / `<!-- current-downloads:end -->`. It does not commit, push, edit GitHub or publish binaries.

## Automated refresh

The existing serialized `publish.yml` release job refreshes the table after successful selected-platform publication. It also runs on docs-only/no-native-change runs to repair stale tables, without creating a new native release. Only the binary publication step requires changed native artifacts. There is no additional push workflow. The container retains its existing independent build policy.

The job uses the repository `GITHUB_TOKEN`; generated README commits therefore do not recursively start push workflows. Branch protection must allow the Contents API update; rejected writes fail visibly. Other active main publication runs cause a conservative deferral, retried by a later run.

A live refresh needs separate authorization because it edits a release description and commits the default-branch README:

```sh
node scripts/current-downloads.mjs --repository everyonesoftware/tasks --publish --output-directory "$TMPDIR/tasks-download-publish"
```

Do not use `--publish` for previews. A personal token's README commit can trigger CI. Local changes take effect only after an authorized commit/push.

## Preservation and concurrency

Only managed blocks are changed; surrounding prose, release titles, assets, tags and Latest policy are preserved. README writes use the current Contents API blob SHA as an optimistic precondition. Release descriptions are re-read before PATCH; external writes are read back and idempotent reruns avoid unnecessary writes.

All automated writers must share the `publish-main` serialization boundary. Do not run a manual refresh alongside CI, or manually edit release descriptions during refresh. Release-body GET/PATCH is not atomic against a human edit between requests: observable edits are rejected, but the API does not provide the same blob-SHA precondition as README writes. A later repair cannot recover an undetected overlapping manual edit.

## Validation

```sh
node --test tests/deployment/current-downloads.test.mjs tests/deployment/selective-builds.test.mjs tests/deployment/windows_release_workflow.test.mjs
```

Write paths use disposable fixtures; live previews are read-only. Native builds and device acceptance are separate gates, not required for a download-table-only change.
