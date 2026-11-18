#!/usr/bin/env node
// Read-only publication selection. Unknown inputs select both native platforms.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const shaPattern = /^[a-f0-9]{40}$/;
function git(root, ...args) {
  const text = execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  return args[0] === 'diff' ? text : text.trim();
}
function inventory(api, path) {
  const items = [];
  for (let page = 1; page <= 5; page++) {
    const batch = api(`${path}?per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length > 100) throw new Error('Invalid publication inventory.');
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error('Publication inventory exceeds bounded lookup; refusing an unverified baseline.');
}
function baseline(platform, releases, api, root, head) {
  for (const release of releases) {
    const number = Number(release.tag_name.slice(1));
    const assets = inventory(api, `releases/${release.id}/assets`);
    if (new Set(assets.map(a => a.name)).size !== assets.length || new Set(assets.map(a => a.id)).size !== assets.length) throw new Error('Duplicate publication asset identity.');
    const androidManifest = assets.some(a => a.name === 'tasks-release.json') ? 'tasks-release.json' : 'daymark-release.json';
    const names = platform === 'android' ? [`Tasks-${number}.apk`, androidManifest, 'SHA256SUMS'] : [`TasksWindows-0.1.${number}-win-x64-full.nupkg`, 'releases.win-x64.json', 'TasksWindows-win-x64-Setup.exe', 'TasksWindows-win-x64-Setup.exe.sha256', `Tasks-Windows-${number}-Setup.exe`, `Tasks-Windows-${number}-Setup.exe.sha256`];
    if (!names.every(name => assets.filter(a => a.name === name && a.state === 'uploaded' && a.size > 0).length === 1)) continue;
    if (platform === 'windows' && number > 65534) throw new Error('Windows publication version exceeds native range.');
    const manifest = assets.find(a => a.name === names[1]);
    if (!Number.isSafeInteger(manifest.id) || manifest.id < 1 || manifest.size > 65536) throw new Error('Invalid publication metadata asset.');
    const metadata = api(`releases/assets/${manifest.id}`, { binaryJson: true });
    if (!metadata || JSON.stringify(metadata).length > 65536) throw new Error('Invalid publication metadata.');
    if (platform === 'android') {
      if (metadata.schemaVersion !== 1 || metadata.packageName !== 'com.everyonesoftware.daymark' || metadata.versionCode !== number || metadata.versionName !== String(number) || metadata.apkAssetName !== names[0] || !/^[a-f0-9]{64}$/.test(metadata.sha256) || !Number.isInteger(metadata.minSdk) || metadata.minSdk < 1 || metadata.minSdk > 1000) throw new Error('Android publication metadata mismatch.');
      const checksum = assets.find(a => a.name === 'SHA256SUMS');
      if (checksum.size > 65536) throw new Error('Invalid publication checksum asset.');
      const text = api(`releases/assets/${checksum.id}`, { binaryText: true });
      if (typeof text !== 'string' || text.length > 65536 || ![`${metadata.sha256}  ${names[0]}`, `${metadata.sha256}  dist/android/${names[0]}`].includes(text.trim())) throw new Error('Android publication checksum mismatch.');
    } else {
      const item = metadata.Assets?.[0];
      if (!Array.isArray(metadata.Assets) || metadata.Assets.length !== 1 || item.PackageId !== 'TasksWindows' || item.Version !== `0.1.${number}` || item.Type !== 'Full' || item.FileName !== names[0] || item.Size !== assets.find(a => a.name === names[0]).size || !/^[a-fA-F0-9]{40}$/.test(item.SHA1) || !/^[a-fA-F0-9]{64}$/.test(item.SHA256)) throw new Error('Windows publication metadata mismatch.');
    }
    let object = api(`git/ref/tags/${release.tag_name}`).object;
    const seen = new Set();
    while (object?.type === 'tag') {
      if (!shaPattern.test(object.sha) || seen.has(object.sha) || seen.size >= 8) throw new Error('Invalid publication tag chain.');
      seen.add(object.sha);
      object = api(`git/tags/${object.sha}`).object;
    }
    if (object?.type !== 'commit' || !shaPattern.test(object.sha) || object.sha !== release.target_commitish) throw new Error('Published tag/source mismatch.');
    if (git(root, 'rev-list', '--count', object.sha) !== String(number)) throw new Error('Publication version/commit-count mismatch.');
    try { git(root, 'merge-base', '--is-ancestor', object.sha, head); }
    catch { throw new Error('Published source is not an ancestor of HEAD (divergent or newer publication).'); }
    return object.sha;
  }
  return null;
}
function workflowInputs(root, source, platform) {
  const text = git(root, 'show', `${source}:.github/workflows/publish.yml`);
  // Deliberately support only this repository's simple, unaliased block layout.
  // Unknown/ambiguous YAML must select a build, never silently drop an input.
  if (/[&*][A-Za-z_]|\t|^---/m.test(text) || (text.match(/^jobs:\s*$/gm) || []).length !== 1) return null;
  // Validate every top-level line before extracting literal env/defaults keys.
  // Quoted/complex keys or multiline headers otherwise look like absent inputs.
  const topKeys = new Set();
  for (const line of text.split('\n')) {
    if (/^\s*$|^#|^ /.test(line)) continue;
    const entry = /^(name|on|permissions|concurrency|env|defaults|jobs): *(.*)$/.exec(line);
    if (!entry || topKeys.has(entry[1]) || topKeys.has('jobs')) return null;
    if (entry[1] === 'name' ? !/^[\w .-]+$/.test(entry[2]) : entry[2] !== '') return null;
    topKeys.add(entry[1]);
  }
  const shared = ['env', 'defaults'].map(key => {
    const blocks = [...text.matchAll(new RegExp(`^${key}:.*(?:\\n(?:[ \\t#].*|))*(?=\\n[^ \\t#]|$)`, 'gm'))];
    return blocks.length > 1 ? null : blocks[0]?.[0] || '';
  });
  if (shared.includes(null)) return null;
  const jobsText = text.slice(text.indexOf('\njobs:') + 7);
  const jobs = [...jobsText.matchAll(/^  ([A-Za-z_][\w-]*):\s*$/gm)];
  if (new Set(jobs.map(m => m[1])).size !== jobs.length) return null;
  const index = jobs.findIndex(m => m[1] === platform);
  if (index < 0) return null;
  const job = jobsText.slice(jobs[index].index, jobs[index + 1]?.index).split('\n').filter(line => !/^    (?:if|needs):/.test(line)).join('\n');
  return JSON.stringify([shared, job]);
}
function affected(path, platform, root, source, head) {
  if (path === '.github/workflows/publish.yml') {
    try {
      const before = workflowInputs(root, source, platform), after = workflowInputs(root, head, platform);
      return before === null || after === null || before !== after;
    } catch { return true; }
  }
  // Documentation and the selector itself are control-plane inputs, not binaries.
  if (path.startsWith('docs/') || path.startsWith('tests/deployment/') || /(?:^|\/)(?:README|AGENTS|CLAUDE)\.md$/.test(path) || /^contracts\/.*\.md$/.test(path) || path === 'scripts/selective-builds.mjs') return false;
  if (path.startsWith('apps/windows/') || path.startsWith('tests/windows/') || /^scripts\/.*windows.*\.(?:mjs|ps1)$/.test(path) || path === '.config/dotnet-tools.json') return platform === 'windows';
  if (path.startsWith('apps/android/') || path === 'contracts/android-release.schema.json') return platform === 'android';
  // Server/web do not compile into either native client (relative authenticated API).
  if (/^(?:apps\/web|services|cmd|tests\/web)\//.test(path) || ['go.mod', 'go.sum', 'Dockerfile', '.dockerignore', 'docker-compose.yml', 'docker-entrypoint.sh', 'scripts/container-tags.sh', 'scripts/publish-notification.mjs'].includes(path)) return false;
  return true;
}
export function selectBuilds({ root, api: publicApi }) {
  let reads = 0;
  const cache = new Map();
  const api = (path, options) => {
    if (cache.has(path)) return cache.get(path);
    if (++reads > 64) throw new Error('Publication API read budget exceeded; refusing unverified selection.');
    const result = publicApi(path, options);
    cache.set(path, result);
    return result;
  };
  if (git(root, 'rev-parse', '--is-shallow-repository') !== 'false') throw new Error('Full history required.');
  const head = git(root, 'rev-parse', 'HEAD');
  const releases = inventory(api, 'releases').filter(r => r.draft === false && r.prerelease === false && /^v[1-9][0-9]*$/.test(r.tag_name)).sort((a, b) => Number(b.tag_name.slice(1)) - Number(a.tag_name.slice(1)));
  for (const release of releases) {
    const number = Number(release.tag_name.slice(1));
    if (!Number.isSafeInteger(release.id) || release.id < 1 || !Number.isSafeInteger(number) || number > 2_100_000_000) throw new Error('Invalid publication version/identity.');
  }
  const result = {};
  for (const platform of ['android', 'windows']) {
    const source = baseline(platform, releases, api, root, head);
    const paths = source === null ? [] : git(root, 'diff', '--name-only', '-z', '--no-renames', source, head, '--').split('\0').filter(Boolean);
    const build = source === null || paths.some(path => affected(path, platform, root, source, head));
    result[platform] = { build, baseline: source, head, reason: source === null ? 'no verified publication' : build ? 'inputs changed since publication' : 'inputs unchanged since publication', paths };
  }
  result.container = { build: true, baseline: null, head, reason: 'container publication source unverified; conservatively retain build' };
  result.release = result.android.build || result.windows.build;
  result.latestEligible = result.android.build;
  return result;
}

export function main(argv = process.argv.slice(2), { root = fileURLToPath(new URL('..', import.meta.url)), env = process.env, run = execFileSync, output = console.log } = {}) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i], value = argv[i + 1];
    if (!['--repository', '--github-output'].includes(key) || Object.hasOwn(options, key) || !value || value.startsWith('--')) throw new Error('Usage: selective-builds.mjs [--repository OWNER/REPO] [--github-output PATH]');
    options[key] = value;
  }
  const repository = options['--repository'] ?? env.GITHUB_REPOSITORY;
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(repository) || repository.split('/').some(p => p === '.' || p === '..')) throw new Error('Invalid repository.');
  if (env.GITHUB_SHA && (!shaPattern.test(env.GITHUB_SHA) || env.GITHUB_SHA !== git(root, 'rev-parse', 'HEAD'))) throw new Error('GITHUB_SHA must match checkout HEAD.');
  const api = (path, { binaryJson = false, binaryText = false } = {}) => {
    const args = ['api', `repos/${repository}/${path}`];
    if (binaryJson || binaryText) args.push('-H', 'Accept: application/octet-stream');
    // Explicit numbered pages, per-call time/size limits; no writes or pagination loops in gh.
    const raw = run('gh', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    return binaryText ? raw : JSON.parse(raw.replace(/^\uFEFF/, ''));
  };
  const result = selectBuilds({ root, api });
  const destination = options['--github-output'] ?? env.GITHUB_OUTPUT;
  if (destination) appendFileSync(destination, `build_android=${result.android.build}\nbuild_windows=${result.windows.build}\nbuild_container=${result.container.build}\nbaseline_android=${result.android.baseline ?? ''}\nbaseline_windows=${result.windows.baseline ?? ''}\nrelease=${result.release}\nlatest_eligible=${result.latestEligible}\n`);
  output(JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    // Do not echo child-process stderr or environment values (may contain credentials).
    console.error(error instanceof SyntaxError ? 'Invalid GitHub API JSON.' : error.code || error.message);
    process.exitCode = 1;
  }
}
