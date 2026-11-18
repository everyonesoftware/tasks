import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as selector from '../../scripts/selective-builds.mjs';
import { readFileSync } from 'node:fs';
import { selectBuilds } from '../../scripts/selective-builds.mjs';

function fixture(t) {
  const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'tasks-selection-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  const commit = (file, text = 'fixture') => {
    mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), text);
    git('add', '.'); git('commit', '-qm', file); return git('rev-parse', 'HEAD');
  };
  const base = commit('apps/android/source.kt');
  return { root, git, commit, base };
}
function publication(sha, number = 1, platform = 'android') {
  const name = platform === 'android' ? `Tasks-${number}.apk` : `TasksWindows-0.1.${number}-win-x64-full.nupkg`;
  const names = platform === 'android' ? [name, 'daymark-release.json', 'SHA256SUMS'] : [name, 'releases.win-x64.json', 'TasksWindows-win-x64-Setup.exe', 'TasksWindows-win-x64-Setup.exe.sha256', `Tasks-Windows-${number}-Setup.exe`, `Tasks-Windows-${number}-Setup.exe.sha256`];
  const release = { id: number, tag_name: `v${number}`, target_commitish: sha, draft: false, prerelease: false };
  const assets = names.map((name, index) => ({ id: number * 100 + index + 1, name, size: 100, state: 'uploaded' }));
  const metadata = platform === 'android' ? { schemaVersion: 1, packageName: 'com.everyonesoftware.daymark', versionCode: number, versionName: String(number), minSdk: 26, apkAssetName: name, sha256: 'a'.repeat(64) } : { Assets: [{ PackageId: 'TasksWindows', Version: `0.1.${number}`, Type: 'Full', FileName: name, Size: 100, SHA1: 'b'.repeat(40), SHA256: 'a'.repeat(64) }] };
  return { release, assets, metadata, platform };
}
function publicApi(publications, override = () => undefined) {
  const calls = [];
  const api = (path, options) => {
    calls.push(path);
    const injected = override(path, options); if (injected !== undefined) return injected;
    if (path === 'releases?per_page=100&page=1') return publications.map(p => p.release);
    for (const p of publications) {
      if (path === `releases/${p.release.id}/assets?per_page=100&page=1`) return p.assets;
      if (path === `git/ref/tags/${p.release.tag_name}`) return { object: { type: 'commit', sha: p.release.target_commitish } };
      const manifests = p.assets.filter(a => (p.platform === 'android' ? ['tasks-release.json', 'daymark-release.json'] : ['releases.win-x64.json']).includes(a.name));
      if (manifests.some(a => path === `releases/assets/${a.id}`)) return p.metadata;
      const checksum = p.assets.find(a => a.name === 'SHA256SUMS');
      if (checksum && path === `releases/assets/${checksum.id}`) return `${p.metadata.sha256}  dist/android/${p.metadata.apkAssetName}\n`;
    }
    throw new Error(`Unexpected public read: ${path}`);
  };
  api.calls = calls; return api;
}

test('Android publication baselines prefer Tasks metadata while retaining legacy-only history', t => {
  const f = fixture(t);
  for (const layout of ['legacy', 'tasks', 'both']) {
    const p = publication(f.base);
    if (layout === 'tasks') p.assets[1].name = 'tasks-release.json';
    if (layout === 'both') p.assets.push({ ...p.assets[1], id: 104, name: 'tasks-release.json' });
    const api = publicApi([p]);
    const result = selectBuilds({ root: f.root, api });
    assert.equal(result.android.baseline, f.base, layout);
    assert.equal(result.android.build, false, layout);
    assert.ok(api.calls.includes(`releases/assets/${layout === 'both' ? 104 : 102}`));
    if (layout === 'both') assert.ok(!api.calls.includes('releases/assets/102'));
  }
  const p = publication(f.base);
  p.assets.push({ ...p.assets[1], id: 104, name: 'tasks-release.json' });
  assert.throws(() => selectBuilds({ root: f.root, api: publicApi([p], path => path === 'releases/assets/104' ? {} : undefined) }), /metadata/);
});

test('publication metadata is identity-checked before it can suppress a build', t => {
  const f = fixture(t);
  for (const mutate of [
    p => { p.metadata.packageName = 'foreign.app'; },
    p => { p.metadata.versionCode = 2; },
    p => { p.metadata.versionName = '2'; },
    p => { p.metadata.apkAssetName = 'foreign.apk'; },
    p => { p.metadata.sha256 = 'invalid'; },
    p => { p.metadata.schemaVersion = 2; },
    p => { p.metadata.minSdk = 0; },
    p => { p.assets[1].size = 65537; },
    p => { p.release.target_commitish = 'main'; },
  ]) {
    const p = publication(f.base); mutate(p);
    assert.throws(() => selectBuilds({ root: f.root, api: publicApi([p]) }), /publication|Published|metadata/i);
  }
  const p = publication(f.base, 1, 'windows');
  for (const field of ['PackageId', 'Version', 'Type', 'FileName', 'Size', 'SHA1', 'SHA256']) {
    const invalid = structuredClone(p); invalid.metadata.Assets[0][field] = 'invalid';
    assert.throws(() => selectBuilds({ root: f.root, api: publicApi([invalid]) }), /metadata/);
  }
  const invalid = structuredClone(p); invalid.metadata.Assets.push(invalid.metadata.Assets[0]);
  assert.throws(() => selectBuilds({ root: f.root, api: publicApi([invalid]) }), /metadata/);
});

test('platform classification keeps native inputs separate and treats unknown inputs conservatively', t => {
  for (const [file, android, windows] of [
    ['apps/android/app/src/main/source.kt', true, false],
    ['scripts/build-windows-installer.ps1', false, true],
    ['scripts/windows-package.mjs', false, true],
    ['scripts/validate-windows-nupkg.ps1', false, true],
    ['tests/windows/updates.test.mjs', false, true],
    ['.config/dotnet-tools.json', false, true],
    ['contracts/android-release.schema.json', true, false],
    ['scripts/build-version.sh', true, true],
    ['docs/ci-publishing.md', false, false],
    ['contracts/auth-and-updates.md', false, false],
    ['AGENTS.md', false, false],
    ['scripts/selective-builds.mjs', false, false],
    ['tests/deployment/selective-builds.test.mjs', false, false],
    ['tests/deployment/github_release_workflow_test.go', false, false],
    ['tests/deployment/windows_release_workflow.test.mjs', false, false],
    ['services/server/main.go', false, false],
    ['apps/web/app.js', false, false],
    ['unexpected/shared-input', true, true],
  ]) {
    const f = fixture(t); f.commit(file);
    // One publication can contain both platforms' inventories.
    const a = publication(f.base), w = publication(f.base, 1, 'windows');
    const api = publicApi([a], path => {
      if (path === 'releases/1/assets?per_page=100&page=1') return [...a.assets, ...w.assets.map(v => ({ ...v, id: v.id + 20 }))];
      if (path === 'releases/assets/122') return w.metadata;
    });
    const result = selectBuilds({ root: f.root, api });
    assert.equal(result.android.build, android, file);
    assert.equal(result.windows.build, windows, file);
    assert.equal(result.latestEligible, android, file);
    assert.equal(result.release, android || windows, file);
  }
});

test('workflow changes select only changed platform build definitions, not selection/release orchestration', t => {
  const f = fixture(t);
  const workflow = android => `name: Publish\ndefaults:\n  run:\n    shell: bash\njobs:\n  validate:\n    steps: []\n  android:\n    needs: validate\n    runs-on: ubuntu-24.04\n    steps:\n      - run: ${android}\n  windows:\n    steps:\n      - run: old-windows\n  release:\n    steps: []\n`;
  const base = f.commit('.github/workflows/publish.yml', workflow('build-android'));
  f.commit('.github/workflows/publish.yml', workflow('build-android').replace('old-windows', 'new-windows').replace('    needs: validate', '    if: needs.validate.outputs.android == \'true\'\n    needs: validate'));
  let result = selectBuilds({ root: f.root, api: publicApi([publication(base, 2)]) });
  assert.equal(result.android.build, false, 'Windows packaging + job condition must not rebuild unchanged APK');
  f.commit('.github/workflows/publish.yml', workflow('new-android-toolchain'));
  result = selectBuilds({ root: f.root, api: publicApi([publication(base, 2)]) });
  assert.equal(result.android.build, true);
});

test('unsupported workflow top-level layouts cannot suppress changed shared inputs', async t => {
  for (const [name, shared] of [
    ['double-quoted env', value => `"env":\n  BUILD_FLAGS: ${value}\n`],
    ['single-quoted env', value => `'env':\n  BUILD_FLAGS: ${value}\n`],
    ['quoted defaults', value => `"defaults":\n  run:\n    shell: ${value}\n`],
    ['single-quoted defaults', value => `'defaults':\n  run:\n    shell: ${value}\n`],
    ['complex env key', value => `? env\n: {BUILD_FLAGS: ${value}}\n`],
    ['multiline env key', value => `env\n: {BUILD_FLAGS: ${value}}\n`],
    ['tagged env key', value => `!!str env:\n  BUILD_FLAGS: ${value}\n`],
    ['unknown block', value => `future-inputs:\n  BUILD_FLAGS: ${value}\n`],
    ['unindented comment inside shared block', value => `env:\n  FIRST: stable\n# continued environment\n  BUILD_FLAGS: ${value}\n`],
  ]) {
    await t.test(name, t => {
      const f = fixture(t);
      const workflow = value => `name: Publish\n${shared(value)}jobs:\n  android:\n    steps:\n      - run: build-android $BUILD_FLAGS\n  windows:\n    steps: []\n`;
      const base = f.commit('.github/workflows/publish.yml', workflow('old'));
      f.commit('.github/workflows/publish.yml', workflow('new'));
      assert.equal(selectBuilds({ root: f.root, api: publicApi([publication(base, 2)]) }).android.build, true);
    });
  }
});

test('current ordinary workflow still skips unchanged Android for a Windows-only workflow edit', t => {
  const f = fixture(t);
  const workflow = readFileSync(new URL('../../.github/workflows/publish.yml', import.meta.url), 'utf8');
  const changed = workflow.replace('run: pwsh ./scripts/build-windows-installer.ps1', 'run: pwsh ./scripts/build-windows-installer.ps1 -WindowsOnlyFixture');
  assert.notEqual(changed, workflow, 'fixture must change the actual Windows build command');
  const base = f.commit('.github/workflows/publish.yml', workflow);
  f.commit('.github/workflows/publish.yml', changed);
  assert.equal(selectBuilds({ root: f.root, api: publicApi([publication(base, 2)]) }).android.build, false);
});

test('baseline must be an ancestor with exact tag commit-count identity; failed pushes remain eligible', t => {
  const f = fixture(t);
  f.commit('apps/android/failed-build.kt'); f.commit('docs/next-push.md');
  assert.equal(selectBuilds({ root: f.root, api: publicApi([publication(f.base)]) }).android.build, true);
  assert.throws(() => selectBuilds({ root: f.root, api: publicApi([publication(f.base, 2)]) }), /count|version/i);
  const head = f.git('rev-parse', 'HEAD');
  f.git('checkout', '-q', '--detach', f.base);
  assert.throws(() => selectBuilds({ root: f.root, api: publicApi([publication(head, 3)]) }), /ancestor|newer/i);
  f.commit('apps/android/divergent.kt');
  assert.throws(() => selectBuilds({ root: f.root, api: publicApi([publication(head, 3)]) }), /ancestor|diverge/i);
});

test('annotated publication tags are peeled with a finite bound and must match source', t => {
  const f = fixture(t), p = publication(f.base);
  const annotation = 'c'.repeat(40);
  const api = publicApi([p], path => {
    if (path === 'git/ref/tags/v1') return { object: { type: 'tag', sha: annotation } };
    if (path === `git/tags/${annotation}`) return { object: { type: 'commit', sha: f.base } };
  });
  assert.equal(selectBuilds({ root: f.root, api }).android.build, false);
  assert.throws(() => selectBuilds({ root: f.root, api: publicApi([p], path => {
    if (path.startsWith('git/')) return { object: { type: 'tag', sha: annotation } };
  }) }), /tag chain/i);
});

test('release and asset reads are bounded, API failures abort, incomplete newer outputs cannot become baseline', t => {
  const f = fixture(t), old = publication(f.base);
  const newerSha = f.commit('apps/windows/new.cs');
  const newer = publication(newerSha, 2); newer.assets = [];
  assert.equal(selectBuilds({ root: f.root, api: publicApi([old, newer]) }).android.baseline, f.base);
  const full = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, tag_name: `historical-${i}`, draft: false, prerelease: false }));
  let pages = 0;
  assert.throws(() => selectBuilds({ root: f.root, api: path => { pages++; assert.match(path, /^releases\?/); return full; } }), /bounded/);
  assert.equal(pages, 5);
  assert.throws(() => selectBuilds({ root: f.root, api: () => { throw new Error('API unavailable'); } }), /API unavailable/);
  assert.throws(() => selectBuilds({ root: f.root, api: publicApi([old], path => path.startsWith('releases/1/assets?') ? Array(100).fill(old.assets[0]) : undefined) }), /bounded/);
  const duplicate = structuredClone(old); duplicate.assets.push(duplicate.assets[0]);
  assert.throws(() => selectBuilds({ root: f.root, api: publicApi([duplicate]) }), /duplicate/i);
});

test('CLI emits explicit boolean outputs only after verified read-only selection', t => {
  const f = fixture(t); f.commit('apps/windows/new.cs');
  const output = join(f.root, 'github-output');
  const env = { GITHUB_REPOSITORY: 'fixture/tasks', GITHUB_SHA: f.git('rev-parse', 'HEAD'), GITHUB_OUTPUT: output };
  const api = publicApi([publication(f.base)]), requests = [];
  const run = (command, args, options) => {
    assert.equal(command, 'gh'); assert.equal(args[0], 'api');
    assert.ok(!args.includes('--paginate')); assert.ok(!args.includes('--method'));
    assert.ok(options.timeout <= 60_000); assert.ok(options.maxBuffer <= 1024 * 1024);
    requests.push(args);
    const value = api(args[1].replace('repos/fixture/tasks/', ''));
    return typeof value === 'string' ? value : JSON.stringify(value);
  };
  assert.equal(typeof selector.main, 'function');
  const result = selector.main([], { root: f.root, env, run, output: () => {} });
  assert.equal(result.latestEligible, false);
  assert.match(readFileSync(output, 'utf8'), /^build_android=false\nbuild_windows=true\nbuild_container=true\n/);
  assert.ok(requests.length > 0);
  assert.throws(() => selector.main([], { root: f.root, env: { ...env, GITHUB_SHA: 'a'.repeat(40) }, run }), /checkout|HEAD/);
  assert.throws(() => selector.main(['--repository', '../bad'], { root: f.root, env, run }), /repository/i);
  assert.throws(() => selector.main(['--unknown', 'x'], { root: f.root, env, run }), /Usage/);
});

test('malformed checksum data and invalid inventory identities cannot suppress builds', t => {
  const f = fixture(t), p = publication(f.base);
  assert.throws(() => selectBuilds({ root: f.root, api: publicApi([p], path => path === 'releases/assets/103' ? `${'b'.repeat(64)}  Tasks-1.apk\n` : undefined) }), /checksum/);
  for (const change of [v => { v.release.id = '../bad'; }, v => { v.release.tag_name = 'v999999999999999999999'; }]) {
    const invalid = structuredClone(p); change(invalid);
    assert.throws(() => selectBuilds({ root: f.root, api: publicApi([invalid]) }), /publication|version/);
  }
});

test('native Windows publication range and total API read budget fail closed', t => {
  const f = fixture(t), oversized = publication(f.base, 65535, 'windows');
  assert.throws(() => selectBuilds({ root: f.root, api: publicApi([oversized]) }), /Windows.*version/);
  const releases = Array.from({ length: 70 }, (_, index) => ({ id: index + 1, tag_name: `v${index + 1}`, target_commitish: f.base, draft: false, prerelease: false }));
  let reads = 0;
  assert.throws(() => selectBuilds({ root: f.root, api: path => { reads++; return path.startsWith('releases?') ? releases : []; } }), /read budget/);
  assert.ok(reads <= 64);
});

test('real deletion/rename paths and whitespace filenames cannot hide changed Android inputs', t => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'apps/windows'), { recursive: true });
  f.git('mv', 'apps/android/source.kt', 'apps/windows/source.kt');
  f.git('commit', '-qm', 'move');
  assert.equal(selectBuilds({ root: f.root, api: publicApi([publication(f.base)]) }).android.build, true);
  const g = fixture(t); g.commit(' docs/not-documentation');
  assert.equal(selectBuilds({ root: g.root, api: publicApi([publication(g.base)]) }).android.build, true);
});

test('verified Android publication is unchanged by Windows-only inputs; no feed means Windows builds', t => {
  const f = fixture(t); f.commit('apps/windows/Tasks.App/source.cs');
  const api = publicApi([publication(f.base)]);
  const result = selectBuilds({ root: f.root, api });
  assert.equal(result.android.build, false);
  assert.equal(result.android.baseline, f.base);
  assert.equal(result.windows.build, true);
  assert.equal(result.container.build, true);
  assert.match(result.container.reason, /unverified/);
  assert.equal(result.latestEligible, false, 'Windows-only release MUST NOT replace Android Latest');
  assert.equal(result.release, true);
  assert.equal(api.calls.filter(p => p.startsWith('releases?')).length, 1);
});
