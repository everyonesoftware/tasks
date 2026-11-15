import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../..', import.meta.url));
const source = file => {
  const absolute = path.join(root, file);
  assert.ok(fs.existsSync(absolute), `Missing installer source: ${file}`);
  return fs.readFileSync(absolute, 'utf8');
};

test('installer has a stable per-user identity and installs only the self-contained payload', () => {
  const script = source('apps/windows/installer/Tasks.iss');
  for (const directive of ['AppId={{d65cbd98-53e5-47a0-8c65-fcc03f2df1ac}', 'AppName=Tasks', 'PrivilegesRequired=lowest', 'DefaultDirName={localappdata}\\Programs\\Tasks', 'ArchitecturesAllowed=x64compatible', 'MinVersion=10.0.19041', 'Uninstallable=yes']) {
    assert.ok(script.includes(directive), `Missing installer directive ${directive}`);
  }
  assert.ok(script.includes('Source: "{#PublishDir}\\*"; DestDir: "{app}";'));
  assert.ok(script.includes('OutputBaseFilename=Tasks-Windows-{#BuildNumber}-Setup'));
  assert.doesNotMatch(script, /\[UninstallDelete\]|\[Registry\]|RunOnce|CurrentVersion\\Run|EveryoneSoftware\\Tasks|\.data\\/);
});

test('release packaging requires unsigned acknowledgement and a real native Windows publish', () => {
  const script = source('scripts/build-windows-installer.ps1');
  assert.match(script, /if \(-not \$AllowUnsigned\)/);
  assert.match(script, /if \(-not \$IsWindows\)/);
  assert.ok(script.includes('apps/windows/build.ps1'));
  assert.ok(script.includes('validate-payload'));
  assert.ok(script.includes('stage-installer'));
  assert.ok(script.includes('FileVersion'));
  assert.doesNotMatch(script, /OutputType=Library|WindowsAppSDKSelfContained=false|Skip.*Check|skip.*check/i);
});

test('native publish embeds the source-bound shared Windows version', () => {
  const script = source('apps/windows/build.ps1');
  assert.ok(script.includes('windows-package.mjs'));
  assert.match(script, /-p:Version=/);
  assert.match(script, /-p:FileVersion=/);
  assert.match(script, /-p:InformationalVersion=/);
  assert.ok(script.includes('-p:IncludeSourceRevisionInInformationalVersion=false'), 'The source SHA must not be appended twice by the SDK');
});

test('the actual packaging entrypoint refuses accidental unsigned builds and non-Windows execution', t => {
  if (process.platform === 'win32') { t.skip('Linux fail-closed gate is a non-Windows check'); return; }
  const pwsh = process.env.PWSH || '/opt/data/tools/powershell-7.5.4/pwsh';
  if (!fs.existsSync(pwsh)) { t.skip('PowerShell is not installed on this host'); return; }
  const script = path.join(root, 'scripts/build-windows-installer.ps1');
  assert.ok(fs.existsSync(script), 'Installer packaging entrypoint is missing');
  for (const [extra, expected] of [[[], /AllowUnsigned/], [['-AllowUnsigned'], /native Windows/i]]) {
    const result = spawnSync(pwsh, ['-NoLogo', '-NoProfile', '-File', script, '-BuildNumber', '137', ...extra], { encoding: 'utf8', timeout: 15000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, expected);
  }
});
