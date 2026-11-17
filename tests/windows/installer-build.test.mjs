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

test('migration guard retains legacy identity without a second installer registration', () => {
  const script = source('apps/windows/installer/Tasks.iss');
  for (const directive of ['AppId={{d65cbd98-53e5-47a0-8c65-fcc03f2df1ac}', 'AppName=Tasks', 'PrivilegesRequired=lowest', 'DefaultDirName={localappdata}\\Programs\\Tasks', 'ArchitecturesAllowed=x64compatible', 'MinVersion=10.0.19041', 'Uninstallable=no', 'CreateAppDir=yes', 'CreateUninstallRegKey=no']) {
    assert.ok(script.includes(directive), `Missing installer directive ${directive}`);
  }
  for (const token of ['HKCU32', 'HKCU64', 'HKLM32', 'HKLM64', '_is1', 'InitializeSetup', 'PrepareToInstall', 'Uninstall Tasks once', 'session', '--installto', '--silent', 'ewWaitUntilTerminated', 'RawSetup', 'GetSHA256OfFile']) assert.ok(script.includes(token), token);
  assert.ok(script.includes('VelopackInstallPresent'), 'Repeated setups must not create a side-by-side registration or relocate an existing installation');
  assert.ok(script.includes('Use the installed app to update'));
  assert.ok(script.includes('DestinationIsSafe'), 'Setup must not install over a nonempty directory or protected session');
  assert.ok(script.includes('FindFirst'));
  assert.ok(script.includes('OutputBaseFilename=Tasks-Windows-{#BuildNumber}-Setup'));
  assert.doesNotMatch(script, /\[UninstallDelete\]|\[Registry\]|\[Icons\]|RunOnce|CurrentVersion\\Run|DelTree|RegDelete/);
});

test('guard uses the real Inno directory mechanism for default and /DIR before any install writes', () => {
  const script = source('apps/windows/installer/Tasks.iss');
  assert.match(script, /^CreateAppDir=yes$/m, 'CreateAppDir=no redirects WizardDirValue to WinDir instead of DefaultDirName or /DIR');
  assert.match(script, /^UsePreviousAppDir=no$/m);
  assert.match(script, /^DefaultDirName=\{localappdata\}\\Programs\\Tasks$/m);
  assert.match(script, /^CreateUninstallRegKey=no$/m);
  assert.match(script, /^Uninstallable=no$/m);
  const prepare = script.slice(script.indexOf('function PrepareToInstall'));
  assert.ok(prepare.indexOf('if not DestinationIsSafe') < prepare.indexOf('ExtractTemporaryFile'));
  assert.ok(prepare.indexOf('if LegacyInstallPresent') < prepare.indexOf('ExtractTemporaryFile'));
  assert.match(prepare, /--silent --installto ' \+ AddQuotes\(WizardDirValue\)/);
  assert.doesNotMatch(script, /ForceDirectories|CreateDir\(|\[Dirs\]|\[Registry\]|\[Icons\]/);
});

test('release packaging requires unsigned acknowledgement and a real native Windows publish', () => {
  const script = source('scripts/build-windows-installer.ps1');
  assert.match(script, /if \(-not \$AllowUnsigned\)/);
  assert.match(script, /if \(-not \$IsWindows\)/);
  assert.ok(script.includes('apps/windows/build.ps1'));
  assert.ok(script.includes('validate-payload'));
  assert.ok(script.includes('stage-velopack'));
  for (const token of ['tool restore', "'vpk'", "'TasksWindows'", "'win-x64'", "'--noPortable'", "'--delta', 'None'", 'validate-windows-nupkg.ps1', 'RawSetupSha256']) assert.ok(script.includes(token), token);
  const manifest = JSON.parse(source('.config/dotnet-tools.json'));
  assert.equal(manifest.tools.vpk.version, '1.2.161');
  assert.equal(manifest.tools.vpk.rollForward, false);
  assert.ok(script.includes('FileVersion'));
  assert.doesNotMatch(script, /OutputType=Library|WindowsAppSDKSelfContained=false|Skip.*Check|skip.*check/i);
});

test('native publish embeds the source-bound shared Windows version', () => {
  const script = source('apps/windows/build.ps1');
  assert.ok(script.includes('dotnet test Tasks.Update.Tests/Tasks.Update.Tests.csproj -c Release'));
  assert.ok(script.includes('--self-contained true'));
  assert.ok(script.includes('windows-package.mjs'));
  assert.match(script, /-p:Version=/);
  assert.match(script, /-p:FileVersion=/);
  assert.match(script, /-p:InformationalVersion=/);
  assert.ok(script.includes('-p:IncludeSourceRevisionInInformationalVersion=false'), 'The source SHA must not be appended twice by the SDK');
});

test('Velopack packing retains the complete publish inventory for byte-for-byte validation', () => {
  const script = source('scripts/build-windows-installer.ps1');
  assert.ok(script.includes("'--noDefaultExclude'"), 'Pinned vpk otherwise drops createdump.exe and other built-in excluded files');
  assert.ok(script.includes("'--exclude', '(?!)'"), 'Override the default PDB exclusion instead of weakening package completeness checks');
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
