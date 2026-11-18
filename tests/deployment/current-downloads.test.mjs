import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const modulePath = new URL('../../scripts/current-downloads.mjs', import.meta.url);
async function subject() { return import(modulePath); }
function fixture(t) {
  const root = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'tasks-downloads-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  const commit = n => { writeFileSync(join(root, 'source'), String(n)); git('add', '.'); git('commit', '-qm', String(n)); return git('rev-parse', 'HEAD'); };
  const repository = 'fixture/tasks';
  const publication = (number, platform, sha) => {
    const names = platform === 'android' ? [`Tasks-${number}.apk`, 'daymark-release.json', 'SHA256SUMS'] : [`TasksWindows-0.1.${number}-win-x64-full.nupkg`, 'releases.win-x64.json', 'TasksWindows-win-x64-Setup.exe', 'TasksWindows-win-x64-Setup.exe.sha256'];
    const assets = names.map((name, i) => ({ id: number * 100 + i, name, state: 'uploaded', size: 100, browser_download_url: `https://github.com/${repository}/releases/download/v${number}/${name}` }));
    const metadata = platform === 'android' ? { schemaVersion: 1, packageName: 'com.everyonesoftware.daymark', versionCode: number, versionName: String(number), minSdk: 26, apkAssetName: names[0], sha256: 'a'.repeat(64) } : { Assets: [{ PackageId: 'TasksWindows', Version: `0.1.${number}`, Type: 'Full', FileName: names[0], Size: 100, SHA1: 'b'.repeat(40), SHA256: 'a'.repeat(64) }] };
    return { release: { id: number, tag_name: `v${number}`, target_commitish: sha, draft: false, prerelease: false, body: `Original notes ${number}\n` }, platform, assets, metadata };
  };
  const publications = [publication(1, 'android', commit(1)), publication(2, 'windows', commit(2))];
  let readme = '# Tasks\n\nKeep this prose.\n', readmeSha = 'c'.repeat(40);
  const calls = [], writes = [];
  const state = { root, repository, publications, calls, writes, override: () => undefined, get readme() { return readme; } };
  state.api = (path, options = {}) => {
    calls.push({ path, options });
    const injected = state.override(path, options); if (injected !== undefined) return injected;
    if (options.method) {
      writes.push({ path, ...options });
      if (path === 'contents/README.md') { assert.equal(options.data.sha, readmeSha); readme = Buffer.from(options.data.content, 'base64').toString(); readmeSha = 'd'.repeat(40); }
      else publications.find(p => path === `releases/${p.release.id}`).release.body = options.data.body;
      return {};
    }
    if (path === '') return { default_branch: 'main' };
    if (path.startsWith('actions/runs?')) return { workflow_runs: [] };
    if (path.startsWith('contents/README.md?')) return { encoding: 'base64', content: Buffer.from(readme).toString('base64'), sha: readmeSha };
    if (path === 'releases?per_page=100&page=1') return structuredClone(publications.map(p => p.release));
    for (const p of publications) {
      if (path === `releases/${p.release.id}`) return structuredClone(p.release);
      if (path === `releases/${p.release.id}/assets?per_page=100&page=1`) return structuredClone(p.assets);
      if (path === `git/ref/tags/${p.release.tag_name}`) return { object: { type: 'commit', sha: p.release.target_commitish } };
      if (path === `releases/assets/${p.assets[1].id}`) return structuredClone(p.metadata);
      if (p.platform === 'android' && path === `releases/assets/${p.assets[2].id}`) return `${p.metadata.sha256}  dist/android/${p.assets[0].name}\n`;
      if (p.platform === 'windows' && path === `releases/assets/${p.assets[3].id}`) return `${'e'.repeat(64)}  TasksWindows-win-x64-Setup.exe\n`;
    }
    throw Error(`Unexpected API read: ${path}`);
  };
  return state;
}

test('preview resolves split platform releases with verified legacy Android metadata and preserves prose', async t => {
  const { refreshDownloads } = await subject(), f = fixture(t);
  const result = refreshDownloads(f);
  assert.equal(result.inventory.android.tag, 'v1');
  assert.equal(result.inventory.android.sourceCommit, f.publications[0].release.target_commitish);
  assert.equal(result.inventory.windows.version, '0.1.2');
  assert.equal(result.tag, 'v2');
  assert.match(result.readme, /Keep this prose/);
  assert.match(result.releaseNotes, /Original notes 2/);
  assert.ok(result.readme.includes(result.table)); assert.ok(result.releaseNotes.includes(result.table));
  assert.match(result.table, /Unsigned/); assert.match(result.table, /release key/);
  assert.match(result.table, /https:\/\/github.com\/fixture\/tasks\/blob\/main\/docs\/docker-deployment.md/);
  assert.equal(f.writes.length, 0);
});

test('publication discovery rejects malformed identity, metadata, checksums and unsafe URLs', async t => {
  const { collectDownloads } = await subject();
  for (const mutate of [
    f => { f.publications[0].metadata.versionCode = 99; },
    f => { f.publications[1].metadata.Assets[0].Version = '0.1.99'; },
    f => { f.publications[0].release.target_commitish = 'main'; },
    f => { f.publications[1].release.target_commitish = f.publications[0].release.target_commitish; },
    f => { f.publications[0].assets[0].browser_download_url = 'https://evil.invalid/a.apk'; },
    f => { f.publications[1].assets[3].size = 65537; },
    f => { f.override = path => path === 'releases/assets/203' ? 'bad checksum' : undefined; },
    f => { f.publications.push(structuredClone(f.publications[0])); },
    f => { f.publications[0].release.id = -1; },
    f => { f.publications[0].release.tag_name = 'v99999999999999999999'; },
  ]) {
    const f = fixture(t); mutate(f);
    assert.throws(() => collectDownloads(f), /publication|metadata|source|count|checksum|inventory|URL|version/i);
  }
});

test('publish preserves prose, uses Contents SHA and exact target readbacks, then is a no-op', async t => {
  const { refreshDownloads } = await subject(), f = fixture(t);
  const result = refreshDownloads({ ...f, publish: true });
  assert.equal(result.published, true);
  assert.deepEqual(f.writes.map(w => [w.path, w.method]), [['releases/2', 'PATCH'], ['contents/README.md', 'PUT']]);
  assert.equal(f.writes[1].data.sha, 'c'.repeat(40));
  assert.equal(f.writes[1].data.branch, 'main');
  assert.equal(f.readme, result.readme);
  assert.equal(f.publications[1].release.body, result.releaseNotes);
  assert.equal(f.publications[0].release.body, 'Original notes 1\n');
  assert.ok(f.calls.findLastIndex(c => c.path === 'releases/2' && !c.options.method) > f.calls.findIndex(c => c.options.method === 'PATCH'));
  f.writes.length = 0;
  refreshDownloads({ ...f, publish: true });
  assert.equal(f.writes.length, 0);
});

test('publish defers other active main runs including publishers starting during discovery', async t => {
  const { refreshDownloads } = await subject();
  for (const startAt of [1, 2]) {
    const f = fixture(t); let reads = 0;
    f.override = path => path.startsWith('actions/runs?') ? { workflow_runs: ++reads >= startAt ? [{ id: 88, status: 'in_progress' }] : [] } : undefined;
    assert.deepEqual(refreshDownloads({ ...f, publish: true, currentRunId: '77' }), { deferred: true });
    assert.equal(f.writes.length, 0);
  }
  const f = fixture(t);
  f.override = path => path.startsWith('actions/runs?') ? { workflow_runs: [{ id: 77, status: 'in_progress' }] } : undefined;
  assert.equal(refreshDownloads({ ...f, publish: true, currentRunId: '77' }).published, true);
});

test('publish rejects observable note edits and target identity races before writes', async t => {
  const { refreshDownloads } = await subject();
  for (const changed of [{ body: 'Human edit' }, { target_commitish: 'f'.repeat(40) }, { tag_name: 'v9' }, { draft: true }]) {
    const f = fixture(t); let reads = 0;
    f.override = (path, options) => path === 'releases/2' && !options.method && ++reads === 2 ? { ...f.publications[1].release, ...changed } : undefined;
    assert.throws(() => refreshDownloads({ ...f, publish: true }), /changed|mismatch|source|target/i);
    assert.equal(f.writes.length, 0);
  }
});

test('publish rejects a concurrently edited README before touching release notes', async t => {
  const { refreshDownloads } = await subject(), f = fixture(t); let reads = 0;
  f.override = path => path.startsWith('contents/README.md?') && ++reads === 2 ? { encoding: 'base64', sha: 'f'.repeat(40), content: Buffer.from('# Tasks\nHuman edit\n').toString('base64') } : undefined;
  assert.throws(() => refreshDownloads({ ...f, publish: true }), /README changed/);
  assert.equal(f.writes.length, 0);
});

test('CLI creates local preview artifacts with bounded read-only gh calls', async t => {
  const { main } = await subject(), f = fixture(t), directory = join(f.root, 'preview');
  writeFileSync(join(f.root, 'README.md'), '# Tasks\nLocal prose\n');
  const run = (command, args, options) => {
    assert.equal(command, 'gh'); assert.equal(args[0], 'api');
    assert.ok(!args.includes('--method')); assert.ok(!args.includes('--paginate'));
    assert.ok(options.timeout <= 60000); assert.ok(options.maxBuffer <= 1024 * 1024);
    const value = f.api(args[1].replace(`repos/${f.repository}`, '').replace(/^\//, ''));
    return typeof value === 'string' ? value : JSON.stringify(value);
  };
  const result = main(['--repository', f.repository, '--output-directory', directory], { root: f.root, run, output: () => {}, env: {} });
  assert.equal(readFileSync(join(directory, 'README.md'), 'utf8'), result.readme);
  assert.match(result.readme, /Local prose/);
  assert.equal(readFileSync(join(directory, 'release-notes.md'), 'utf8'), result.releaseNotes);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'downloads.json'), 'utf8')), result.inventory);
  for (const args of [[], ['--repository', '../bad'], ['--repository', f.repository], ['--repository', f.repository, '--publish', '--publish']]) assert.throws(() => main(args, { run }), /Usage|repository|output-directory/);
  assert.equal(f.writes.length, 0);
});

test('markers replace only owned blocks and reject ambiguity', async () => {
  const { replaceDownloads } = await subject();
  const start = '<!-- current-downloads:start -->', end = '<!-- current-downloads:end -->';
  assert.equal(replaceDownloads(`before\n${start}\nold\n${end}\nafter`, 'new'), `before\n${start}\nnew\n${end}\nafter`);
  for (const text of [start, end, end + start, start + start + end, start + end + end]) assert.throws(() => replaceDownloads(text, 'new'), /Malformed/);
  assert.throws(() => replaceDownloads('no title', 'new', { readme: true }), /title/);
});

test('publish detects newest release races, malformed markers and failed write readbacks', async t => {
  const { refreshDownloads } = await subject();
  for (const scenario of ['newest', 'release-readback', 'readme-readback', 'release-markers', 'readme-markers']) {
    const f = fixture(t); let reads = 0;
    f.override = (path, options) => {
      if (scenario === 'newest' && path === 'releases?per_page=100&page=1' && ++reads === 2) return [];
      if (scenario === 'release-readback' && path === 'releases/2' && !options.method && ++reads === 3) return { ...f.publications[1].release, body: 'write disappeared' };
      if (scenario === 'readme-readback' && path.startsWith('contents/README.md?') && ++reads === 3) return { encoding: 'base64', sha: 'f'.repeat(40), content: Buffer.from('# Tasks\nwrite disappeared').toString('base64') };
      if (scenario === 'release-markers' && path === 'releases/2' && !options.method) return { ...f.publications[1].release, body: '<!-- current-downloads:end -->' };
      if (scenario === 'readme-markers' && path.startsWith('contents/README.md?')) return { encoding: 'base64', sha: 'c'.repeat(40), content: Buffer.from('# Tasks\n<!-- current-downloads:start -->').toString('base64') };
    };
    assert.throws(() => refreshDownloads({ ...f, publish: true }), /changed|readback mismatch|Malformed/i);
    if (['newest', 'release-markers', 'readme-markers'].includes(scenario)) assert.equal(f.writes.length, 0);
  }
});

test('bounded inventory reads fail closed and incomplete newer assets retain the previous platform', async t => {
  const { collectDownloads, refreshDownloads } = await subject(), f = fixture(t);
  f.publications[1].assets = [];
  assert.equal(collectDownloads(f).windows, null);
  const full = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, tag_name: `other-${i}`, draft: false, prerelease: false }));
  let reads = 0;
  assert.throws(() => collectDownloads({ ...f, api: () => { reads++; return full; } }), /bounded/);
  assert.equal(reads, 5);
  assert.throws(() => refreshDownloads({ ...f, publish: true, api: () => ({ workflow_runs: 'bad' }) }), /Actions/);
  f.override = path => { if (path.startsWith('releases?')) throw Error('Network unavailable'); };
  assert.throws(() => collectDownloads(f), /Network unavailable/);
});

test('published checksums must match GitHub asset digests when supplied', async t => {
  const { collectDownloads } = await subject();
  for (const platform of ['android', 'windows']) {
    const f = fixture(t), p = f.publications.find(p => p.platform === platform);
    const installer = p.assets.find(a => a.name.endsWith(platform === 'android' ? '.apk' : 'Setup.exe'));
    installer.digest = `sha256:${'f'.repeat(64)}`;
    assert.throws(() => collectDownloads(f), /digest/);
  }
});

test('primary Tasks metadata wins over legacy metadata and malformed primary cannot fall back', async t => {
  const { collectDownloads } = await subject(), f = fixture(t), p = f.publications[0];
  p.assets.push({ ...p.assets[1], id: 110, name: 'tasks-release.json' });
  f.override = path => path === 'releases/assets/110' ? structuredClone(p.metadata) : undefined;
  assert.equal(collectDownloads(f).android.tag, 'v1');
  f.override = path => path === 'releases/assets/110' ? {} : undefined;
  assert.throws(() => collectDownloads(f), /metadata/);
});

test('CLI publish uses explicit gh write payloads and readbacks without changing local README', async t => {
  const { main } = await subject(), f = fixture(t), directory = join(f.root, 'publish-preview');
  writeFileSync(join(f.root, 'README.md'), '# Local checkout\nKeep local\n');
  const run = (command, args, options) => {
    assert.equal(command, 'gh');
    const methodIndex = args.indexOf('--method');
    const method = methodIndex < 0 ? undefined : args[methodIndex + 1];
    const value = f.api(args[1].replace(`repos/${f.repository}`, '').replace(/^\//, ''), method ? { method, data: JSON.parse(options.input) } : {});
    return typeof value === 'string' ? value : JSON.stringify(value);
  };
  const result = main(['--repository', f.repository, '--output-directory', directory, '--publish'], { root: f.root, run, env: { GITHUB_RUN_ID: '77' }, output: () => {} });
  assert.equal(result.published, true);
  assert.equal(f.writes.length, 2);
  assert.equal(readFileSync(join(directory, 'README.md'), 'utf8'), result.readme);
  assert.equal(readFileSync(join(f.root, 'README.md'), 'utf8'), '# Local checkout\nKeep local\n');
});
