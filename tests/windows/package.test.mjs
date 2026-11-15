import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const moduleUrl = new URL('../../scripts/windows-package.mjs', import.meta.url);
const modulePath = fileURLToPath(moduleUrl);
assert.ok(fs.existsSync(modulePath), 'Windows installer packaging implementation is missing');
const { validateBuildNumber, buildInfo, validatePayload, stageInstaller } = await import(moduleUrl.href);

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'tasks-package-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
// Synthetic PE headers exercise inventory validation only, never native acceptance.
function testPe(machine = 0x8664) {
  const bytes = Buffer.alloc(256);
  bytes.write('MZ'); bytes.writeUInt32LE(128, 0x3c);
  bytes.write('PE\0\0', 128, 'binary'); bytes.writeUInt16LE(machine, 132);
  return bytes;
}
function payload(directory) {
  fs.mkdirSync(directory, { recursive: true });
  for (const name of ['Tasks.exe', 'Tasks.dll', 'Microsoft.ui.xaml.dll', 'Microsoft.WindowsAppRuntime.dll', 'coreclr.dll']) {
    fs.writeFileSync(path.join(directory, name), testPe());
  }
  fs.writeFileSync(path.join(directory, 'resources.pri'), 'fixture-resource-index');
}

test('Windows build numbers preserve the shared integer identity and .NET component bounds', () => {
  assert.equal(validateBuildNumber('137'), 137);
  assert.equal(validateBuildNumber('65534'), 65534);
  for (const invalid of ['0', '-1', '01', '1.0', '1x', '65535', '', ' 1', '1\n']) {
    assert.throws(() => validateBuildNumber(invalid), /build number/i, invalid);
  }
});

test('Windows versions are derived from real full history and reject a mismatched requested build', t => {
  const directory = fixture(t);
  const git = (...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture only');
  const info = buildInfo(directory, '1');
  assert.equal(info.buildNumber, 1);
  assert.equal(info.version, '0.1.1');
  assert.equal(info.fileVersion, '0.1.1.0');
  assert.equal(info.sourceSha, git('rev-parse', 'HEAD'));
  assert.throws(() => buildInfo(directory, '2'), /source commit/);
  fs.writeFileSync(path.join(directory, '.git', 'shallow'), info.sourceSha + '\n');
  assert.throws(() => buildInfo(directory, '1'), /full Git history/);
});

test('native inventory requires the actual runtime and merged PRI, preserving case spelling', t => {
  const directory = fixture(t); payload(directory);
  const files = validatePayload(directory);
  assert.ok(files.includes('Microsoft.ui.xaml.dll'));
  assert.ok(files.includes('resources.pri'));
});

test('a missing runtime, missing PRI, or compile-only library is not publishable', t => {
  for (const missing of ['Tasks.exe', 'resources.pri', 'coreclr.dll', 'Microsoft.WindowsAppRuntime.dll']) {
    const directory = path.join(fixture(t), missing); payload(directory);
    fs.unlinkSync(path.join(directory, missing));
    assert.throws(() => validatePayload(directory), /missing/i);
  }
});

test('wrong native architecture and invalid PE files fail closed', t => {
  const directory = fixture(t); payload(directory);
  fs.writeFileSync(path.join(directory, 'coreclr.dll'), testPe(0x14c));
  assert.throws(() => validatePayload(directory), /x64|architecture/i);
  fs.writeFileSync(path.join(directory, 'coreclr.dll'), 'not-a-native-runtime');
  assert.throws(() => validatePayload(directory), /PE|executable/i);
});

test('case-fold collisions cannot silently replace a Windows payload member', t => {
  if (process.platform === 'win32') return; // NTFS normally rejects this fixture itself.
  const directory = fixture(t); payload(directory);
  fs.copyFileSync(path.join(directory, 'Tasks.dll'), path.join(directory, 'TASKS.DLL'));
  assert.throws(() => validatePayload(directory), /duplicate|collision/i);
});

test('symlinks and sensitive local data never enter an installer', t => {
  const directory = fixture(t); payload(directory);
  for (const name of ['.env', 'session.dat', 'signing.key', 'task-cache.sqlite3']) {
    fs.writeFileSync(path.join(directory, name), 'fixture-not-a-secret');
    assert.throws(() => validatePayload(directory), /sensitive|private/i);
    fs.unlinkSync(path.join(directory, name));
  }
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(directory, 'Tasks.dll'), path.join(directory, 'linked.dll'));
    assert.throws(() => validatePayload(directory), /link/i);
  }
});

test('staging names and hashes the exact installer without overwriting existing bytes', t => {
  const directory = fixture(t), source = path.join(directory, 'compiled-setup.exe'), destination = path.join(directory, 'release');
  const bytes = testPe(0x14c); fs.writeFileSync(source, bytes);
  const result = stageInstaller(source, destination, '137');
  assert.equal(result.filename, 'Tasks-Windows-137-Setup.exe');
  assert.deepEqual(fs.readFileSync(path.join(destination, result.filename)), bytes);
  assert.equal(result.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(fs.readFileSync(path.join(destination, result.filename + '.sha256'), 'utf8'), `${result.sha256}  ${result.filename}\n`);
  assert.throws(() => stageInstaller(source, destination, '137'), /exist|empty/i);
  assert.deepEqual(fs.readFileSync(path.join(destination, result.filename)), bytes);
});

test('staging rejects an absent or non-executable setup before creating release files', t => {
  const directory = fixture(t), source = path.join(directory, 'bad.exe'), destination = path.join(directory, 'release');
  fs.writeFileSync(source, 'fixture plain text, not an installer');
  assert.throws(() => stageInstaller(source, destination, '137'), /PE|executable/i);
  assert.ok(!fs.existsSync(destination));
});

test('staging refuses a symlinked release directory', t => {
  if (process.platform === 'win32') { t.skip('Symlink creation requires host privileges'); return; }
  const directory = fixture(t), source = path.join(directory, 'compiled.exe'), target = path.join(directory, 'target'), destination = path.join(directory, 'release');
  fs.writeFileSync(source, testPe(0x14c)); fs.mkdirSync(target); fs.symlinkSync(target, destination, 'dir');
  assert.throws(() => stageInstaller(source, destination, '137'), /link|directory/i);
  assert.deepEqual(fs.readdirSync(target), []);
});
