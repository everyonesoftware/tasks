#!/usr/bin/env node
import { inventory, baseline } from './selective-builds.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = fileURLToPath(new URL('..', import.meta.url));

function validateRepository(repository) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(repository) || repository.split('/').some(p => p === '.' || p === '..')) throw Error('Invalid repository.');
}
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024 }).trim();
function discover({ repository, api: publicApi, root }) {
  validateRepository(repository);
  let reads = 0;
  const cache = new Map();
  const api = (path, options) => {
    if (!cache.has(path)) {
      if (++reads > 64) throw Error('Publication API read budget exceeded.');
      cache.set(path, publicApi(path, options));
    }
    return cache.get(path);
  };
  if (git(root, 'rev-parse', '--is-shallow-repository') !== 'false') throw Error('Full history required.');
  const head = git(root, 'rev-parse', 'HEAD');
  const releases = stableInventory(api);
  const downloads = { repository, android: null, windows: null };
  for (const platform of ['android', 'windows']) {
    const sourceCommit = baseline(platform, releases, api, root, head);
    if (sourceCommit === null) continue;
    const release = releases.find(r => r.target_commitish === sourceCommit && git(root, 'rev-list', '--count', sourceCommit) === r.tag_name.slice(1));
    const assets = inventory(api, `releases/${release.id}/assets`);
    const version = release.tag_name.slice(1);
    const installerName = platform === 'windows' ? 'TasksWindows-win-x64-Setup.exe' : `Tasks-${version}.apk`;
    let installerHash;
    if (platform === 'windows') {
      const checksum = assets.find(a => a.name === 'TasksWindows-win-x64-Setup.exe.sha256');
      if (!Number.isSafeInteger(checksum.id) || checksum.id < 1 || checksum.size > 65536) throw Error('Invalid publication checksum asset.');
      const text = api(`releases/assets/${checksum.id}`, { binaryText: true });
      if (typeof text !== 'string' || text.length > 65536 || !/^[a-fA-F0-9]{64}  TasksWindows-win-x64-Setup\.exe$/.test(text.trim())) throw Error('Windows publication checksum mismatch.');
      installerHash = text.trim().slice(0, 64).toLowerCase();
    } else {
      const manifest = assets.find(a => a.name === 'tasks-release.json') ?? assets.find(a => a.name === 'daymark-release.json');
      installerHash = api(`releases/assets/${manifest.id}`, { binaryJson: true }).sha256;
    }
    const installer = assets.find(a => a.name === installerName);
    if (installer.digest != null && installer.digest !== `sha256:${installerHash}`) throw Error('Published installer digest mismatch.');
    const url = name => {
      const asset = assets.find(a => a.name === name);
      const expected = `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`;
      if (asset?.browser_download_url !== expected) throw Error('Invalid published download URL.');
      return expected;
    };
    downloads[platform] = { version: platform === 'windows' ? `0.1.${version}` : version, tag: release.tag_name, sourceCommit,
      url: url(platform === 'windows' ? 'TasksWindows-win-x64-Setup.exe' : `Tasks-${version}.apk`),
      checksum: url(platform === 'windows' ? 'TasksWindows-win-x64-Setup.exe.sha256' : 'SHA256SUMS') };
  }
  return { inventory: downloads, releases };
}
function stableInventory(api) {
  const listed = inventory(api, 'releases'), ids = new Set(), tags = new Set();
  for (const r of listed) {
    if (!r || !Number.isSafeInteger(r.id) || r.id < 1 || typeof r.tag_name !== 'string' || typeof r.draft !== 'boolean' || typeof r.prerelease !== 'boolean' || ids.has(r.id) || tags.has(r.tag_name)) throw Error('Invalid or duplicate publication inventory.');
    ids.add(r.id); tags.add(r.tag_name);
    if (!r.draft && !r.prerelease && /^v[0-9]/.test(r.tag_name) && (!/^v[1-9][0-9]*$/.test(r.tag_name) || !Number.isSafeInteger(Number(r.tag_name.slice(1))) || Number(r.tag_name.slice(1)) > 2_100_000_000)) throw Error('Invalid publication version.');
  }
  return listed.filter(r => r.draft === false && r.prerelease === false && /^v[1-9][0-9]*$/.test(r.tag_name)).sort((a, b) => Number(b.tag_name.slice(1)) - Number(a.tag_name.slice(1)));
}
export function collectDownloads(options) { return discover(options).inventory; }
export function renderDownloads({ repository, android, windows }) {
  const row = (item, platform, action, status) => item ? `| ${platform} | ${item.version} | [${action}](${item.url}) · [SHA-256](${item.checksum}) | ${status} |` : `| ${platform} | — | Not yet published | ${status} |`;
  return ['## Current downloads', '', 'Each platform keeps its newest verified manifest-backed publication; versions may differ.', '',
    '| Platform | Version | Download | Status |', '| --- | --- | --- | --- |',
    row(windows, 'Windows x64', 'Installer (.exe)', 'Unsigned; Windows may show an unknown-publisher/SmartScreen warning.'),
    row(android, 'Android', 'APK', 'Signed with the Tasks release key.'),
    `| Web / server | — | [Deployment documentation](https://github.com/${repository}/blob/main/docs/docker-deployment.md) | Self-hosted together; no standalone web installer. |`, '',
    'Verify SHA-256 checksums before installation. Unchanged platforms retain their original release, version and source identity. This table is not an in-app update feed.'
  ].join('\n');
}
export function replaceDownloads(text, table, { readme = false } = {}) {
  const start = '<!-- current-downloads:start -->', end = '<!-- current-downloads:end -->';
  const starts = text.split(start).length - 1, ends = text.split(end).length - 1;
  const block = `${start}\n${table}\n${end}`;
  if (starts || ends) {
    if (starts !== 1 || ends !== 1 || text.indexOf(end) < text.indexOf(start)) throw Error('Malformed current-downloads markers.');
    return text.slice(0, text.indexOf(start)) + block + text.slice(text.indexOf(end) + end.length);
  }
  if (readme) {
    const heading = /^# [^\n]+\n/.exec(text);
    if (!heading) throw Error('README must start with a title.');
    return heading[0] + '\n' + block + '\n\n' + text.slice(heading[0].length);
  }
  return block + (text ? '\n\n' + text : '\n');
}
function decodeReadme(value) {
  if (value?.encoding !== 'base64' || typeof value.content !== 'string' || !/^[a-f0-9]{40}$/.test(value.sha)) throw Error('Invalid README content.');
  const canonical = value.content.replace(/[\r\n]/g, ''), bytes = Buffer.from(canonical, 'base64'), text = bytes.toString('utf8');
  if (bytes.toString('base64') !== canonical || !Buffer.from(text).equals(bytes)) throw Error('Invalid README base64/UTF-8 content.');
  return text;
}
function otherPublishers(api, currentRunId) {
  for (let page = 1; page <= 5; page++) {
    const runs = api(`actions/runs?branch=main&per_page=100&page=${page}`)?.workflow_runs;
    if (!Array.isArray(runs) || runs.length > 100 || runs.some(r => !Number.isSafeInteger(r.id) || r.id < 1 || typeof r.status !== 'string')) throw Error('Invalid Actions run inventory.');
    if (runs.some(r => r.status !== 'completed' && !(currentRunId && String(r.id) === currentRunId))) return true;
    if (runs.length < 100) return false;
  }
  throw Error('Actions inventory exceeds bounded lookup.');
}
export function refreshDownloads({ repository, api: publicApi, root = defaultRoot, localReadme, publish = false, currentRunId = process.env.GITHUB_RUN_ID ?? '' }) {
  validateRepository(repository);
  let reads = 0;
  const api = (path, options = {}) => {
    if (!options.method && ++reads > 192) throw Error('GitHub API read budget exceeded.');
    return publicApi(path, options);
  };
  if (publish && otherPublishers(api, currentRunId)) return { deferred: true };
  const { inventory: downloads, releases } = discover({ repository, api, root });
  const newest = releases[0], target = newest ? api(`releases/${newest.id}`) : null;
  const checkTarget = value => {
    if (!value || value.id !== newest.id || value.tag_name !== newest.tag_name || value.target_commitish !== newest.target_commitish || value.draft !== false || value.prerelease !== false || !/^[a-f0-9]{40}$/.test(value.target_commitish) || (value.body != null && typeof value.body !== 'string')) throw Error('Stable release target changed or invalid source.');
    let object = api(`git/ref/tags/${value.tag_name}`)?.object;
    const seen = new Set();
    while (object?.type === 'tag') {
      if (!/^[a-f0-9]{40}$/.test(object.sha) || seen.has(object.sha) || seen.size >= 8) throw Error('Invalid release tag chain.');
      seen.add(object.sha); object = api(`git/tags/${object.sha}`)?.object;
    }
    if (object?.type !== 'commit' || object.sha !== value.target_commitish) throw Error('Release target tag/source mismatch.');
    if (git(root, 'rev-list', '--count', object.sha) !== value.tag_name.slice(1)) throw Error('Release target version/count mismatch.');
    try { git(root, 'merge-base', '--is-ancestor', object.sha, 'HEAD'); } catch { throw Error('Release target source is not an ancestor of HEAD.'); }
  };
  if (target) checkTarget(target);
  const branch = api('').default_branch;
  if (typeof branch !== 'string' || !branch || /[\r\n\0]/.test(branch)) throw Error('Invalid default branch.');
  const readmePath = `contents/README.md?ref=${encodeURIComponent(branch)}`;
  const original = api(readmePath), remoteReadme = decodeReadme(original);
  const table = renderDownloads(downloads);
  const readme = replaceDownloads(publish ? remoteReadme : localReadme ?? remoteReadme, table, { readme: true });
  const releaseNotes = target ? replaceDownloads(target.body ?? '', table) : null;
  if (publish) {
    if (otherPublishers(api, currentRunId)) return { deferred: true };
    if (stableInventory(api)[0]?.id !== newest?.id) throw Error('Newest stable release changed; retry refresh.');
    const freshReadme = api(readmePath);
    if (freshReadme.sha !== original.sha || decodeReadme(freshReadme) !== remoteReadme) throw Error('README changed; retry refresh.');
    if (target) {
      const fresh = api(`releases/${target.id}`);
      checkTarget(fresh);
      // GitHub release PATCH has no body CAS. Serialize automated writers with
      // publish-main; humans must not edit notes during the GET/PATCH gap.
      if (fresh.body !== target.body) throw Error('Release changed; retry refresh.');
      if (releaseNotes !== (target.body ?? '')) api(`releases/${target.id}`, { method: 'PATCH', data: { body: releaseNotes } });
      const verified = api(`releases/${target.id}`);
      checkTarget(verified);
      if (verified.body !== releaseNotes) throw Error('Release readback mismatch.');
    }
    if (readme !== remoteReadme) api('contents/README.md', { method: 'PUT', data: { message: 'docs: refresh current platform downloads', branch, sha: original.sha, content: Buffer.from(readme).toString('base64') } });
    if (decodeReadme(api(readmePath)) !== readme) throw Error('README readback mismatch.');
  }
  return { inventory: downloads, table, readme, releaseNotes, tag: target?.tag_name ?? null, published: publish };
}

export function main(argv = process.argv.slice(2), { root = defaultRoot, env = process.env, run = execFileSync, output = console.log } = {}) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!['--repository', '--output-directory', '--publish'].includes(key) || Object.hasOwn(options, key)) throw Error('Usage: current-downloads.mjs --repository OWNER/REPO --output-directory PATH [--publish]');
    if (key === '--publish') options[key] = true;
    else {
      const value = argv[++i];
      if (!value || value.startsWith('-') || /[\r\n\0]/.test(value)) throw Error('Usage: missing or invalid option value.');
      options[key] = value;
    }
  }
  const repository = options['--repository']; validateRepository(repository);
  if (!options['--output-directory']) throw Error('Requires --output-directory.');
  if (env.GITHUB_SHA && (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA) || env.GITHUB_SHA !== git(root, 'rev-parse', 'HEAD'))) throw Error('GITHUB_SHA must match checkout HEAD.');
  const api = (path, { method, data, binaryJson = false, binaryText = false } = {}) => {
    const args = ['api', `repos/${repository}${path ? '/' + path : ''}`];
    if (binaryJson || binaryText) args.push('-H', 'Accept: application/octet-stream');
    if (method) args.push('--method', method, '--input', '-');
    const raw = run('gh', args, { encoding: 'utf8', shell: false, timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...(method ? { input: JSON.stringify(data) } : {}) });
    return binaryText ? raw : JSON.parse(raw.replace(/^\uFEFF/, ''));
  };
  const result = refreshDownloads({ repository, api, root, publish: Boolean(options['--publish']), currentRunId: env.GITHUB_RUN_ID ?? '', localReadme: options['--publish'] ? undefined : readFileSync(join(root, 'README.md'), 'utf8') });
  if (!result.deferred) {
    const directory = resolve(options['--output-directory']); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'README.md'), result.readme);
    writeFileSync(join(directory, 'release-notes.md'), result.releaseNotes ?? '');
    writeFileSync(join(directory, 'downloads.json'), JSON.stringify(result.inventory, null, 2) + '\n');
  }
  output(JSON.stringify(result.deferred ? result : { tag: result.tag, published: result.published, inventory: result.inventory }, null, 2));
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    // Never echo gh stderr, input payloads or environment secrets.
    console.error(error instanceof SyntaxError ? 'Invalid GitHub API JSON.' : error.code || error.message);
    process.exitCode = 1;
  }
}
