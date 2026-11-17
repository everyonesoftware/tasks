import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../../scripts/test-windows-installer.ps1', import.meta.url));
const pwsh = process.env.PWSH ?? (existsSync('/opt/data/tools/powershell-7.5.4/pwsh') ? '/opt/data/tools/powershell-7.5.4/pwsh' : 'pwsh');
const env = { ...process.env, LD_LIBRARY_PATH: ['/opt/data/tools/icu/usr/lib/x86_64-linux-gnu', process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') };
const available = !spawnSync(pwsh, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { env }).error;
function run(code, extra = {}) {
  const result = spawnSync(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', code], {
    encoding: 'utf8', timeout: 30000, env: { ...env, SCRIPT: script, ...extra },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}
const extract = String.raw`
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($env:SCRIPT, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$functions = $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]}, $false)
foreach ($function in $functions) { . ([scriptblock]::Create($function.Extent.Text)) }
function Assert-Throws([scriptblock]$Action) {
  $threw = $false
  try { & $Action } catch { $threw = $true }
  if (-not $threw) { throw 'Expected rejection, but operation succeeded' }
}
`;

test('native gate refuses Linux with retained failed summary and no installation', { skip: !available || process.platform === 'win32' }, () => {
  const base = mkdtempSync(join(tmpdir(), 'tasks-installer-test-'));
  const evidence = join(base, 'evidence');
  try {
    const result = spawnSync(pwsh, ['-NoProfile', '-File', script, '-InstallerPath', join(base, 'missing.exe'), '-EvidenceDirectory', evidence], {
      encoding: 'utf8', timeout: 15000, env: { ...env, RUNNER_TEMP: base, GITHUB_ACTIONS: 'true' },
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const summary = JSON.parse(readFileSync(join(evidence, 'summary.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(summary.status, 'failed');
    assert.match(summary.failure, /Native Windows/);
    assert.equal(summary.installVerified, false);
    assert.equal(summary.windowVerified, false);
    assert.equal(summary.uninstallVerified, false);
    assert.equal(summary.installRoot, null);
    assert.equal(existsSync(join(evidence, 'window.png')), false);
    assert.equal(existsSync(join(evidence, 'transcript.log')), true);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('evidence preflight rejects outside paths, missing runner temp and retained diagnostics without overwriting', { skip: !available }, () => {
  const base = mkdtempSync(join(tmpdir(), 'tasks-evidence-test-'));
  try {
    const attempt = (evidence, runnerTemp) => spawnSync(pwsh, ['-NoProfile', '-File', script, '-InstallerPath', join(base, 'missing.exe'), '-EvidenceDirectory', evidence], {
      encoding: 'utf8', timeout: 15000, env: { ...env, RUNNER_TEMP: runnerTemp, GITHUB_ACTIONS: 'true' },
    });
    // This test never reaches an installer, including when run on native Windows.
    assert.equal(attempt(join(base, 'no-runner'), '').status, 1);
    assert.equal(existsSync(join(base, 'no-runner')), false);
    const outside = base + '-outside';
    assert.equal(attempt(outside, base).status, 1);
    assert.equal(existsSync(outside), false);
    const result = attempt(join(base, 'evidence'), base);
    assert.equal(result.status, 1);
    const retained = readFileSync(join(base, 'evidence', 'summary.json'), 'utf8');
    assert.equal(attempt(join(base, 'evidence'), base).status, 1);
    assert.equal(readFileSync(join(base, 'evidence', 'summary.json'), 'utf8'), retained);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('lifecycle requires guarded setup, real Velopack layout, rendered window and independent removal', () => {
  const source = readFileSync(script, 'utf8');
  for (const token of ["$env:GITHUB_ACTIONS -cne 'true'", 'RUNNER_TEMP', 'LocalApplicationData', 'EveryoneSoftware',
    'd65cbd98-53e5-47a0-8c65-fcc03f2df1ac', 'Registry64', 'Registry32', 'LocalMachine', 'CurrentUser',
    'Tasks.lnk', 'Programs\\Tasks', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/DIR=', '/LOG=',
    'Update.exe', 'Tasks.exe', 'resources.pri', 'Microsoft.UI.Xaml.dll', 'Microsoft.WindowsAppRuntime.dll', 'coreclr.dll', 'Tasks.dll',
    'DwmGetWindowAttribute', 'CopyFromScreen', 'GetForegroundWindow', 'OpenInputDesktop', 'SwitchDesktop',
    'WM_CLOSE', 'screenshotSha256', 'Select-Object DisplayName, DisplayVersion, InstallLocation, UninstallString',
    'Assert-RemovedState', 'Invoke-CleanupAction', 'Remove-OwnedDirectory', 'System.Drawing']) {
    assert.ok(source.includes(token), `missing lifecycle requirement: ${token}`);
  }
  assert.match(source, /Assert-NewProfile \$profile \$localData/);
  assert.match(source, /Remove-EmptyProfile \$profile \$localData/);
  assert.match(source, /\$lifecycleDeadline = \$started.AddSeconds\(200\)/);
  assert.match(source, /'install' \(Get-OperationBudget \$lifecycleDeadline 60\)/);
  assert.match(source, /'uninstall' \(Get-OperationBudget \$lifecycleDeadline 60\)/);
  assert.match(source, /\$stableSamples -ge 3/);
  assert.match(source, /\$colors.Count -lt 8/);
  assert.match(source, /\$_.ExecutablePath -ieq \$appExe/);
  assert.match(source, /\$summary.status -ne 'passed'/);
  assert.ok(source.indexOf('Save-WindowScreenshot $window') < source.indexOf('$summary.windowVerified = $true'));
  assert.ok(source.indexOf('Assert-RemovedState $remaining') < source.indexOf('$summary.uninstallVerified = $true'));
  for (const token of ['TasksWindows', 'current\\Tasks.exe', 'Update.exe', '--uninstall', '--silent', '--log', 'Invoke-LegacyRefusalGate', 'legacyRegistrationRefusalVerified', 'legacy-refusal', 'repeat-setup-refusal', 'reinstallRefusalVerified']) assert.ok(source.includes(token), token);
  assert.doesNotMatch(source, /testdriver|fixture.password|--installto/i);
});

test('Start menu acceptance rejects wrong executable and nonempty launch arguments through the real gate predicate', { skip: !available }, () => {
  run(extract + String.raw`
$source = [IO.File]::ReadAllText($env:SCRIPT)
$start = $source.IndexOf('    $links = @(Get-TaskLinks)')
$end = $source.IndexOf('    if (Test-Path -LiteralPath $profile)', $start)
if ($start -lt 0 -or $end -le $start) { throw 'Missing installed shortcut acceptance block' }
$accept = [scriptblock]::Create($source.Substring($start, $end - $start))
$installRoot = 'C:\owned fixture'; $appExe = $installRoot + '\current\Tasks.exe'
$startMenu = [Environment]::GetFolderPath('StartMenu')
function Get-TaskLinks { $fixtureLink }
function Write-Json { param($Value, $Name) }
$fixtureLink = [pscustomobject]@{ path = $startMenu + '\Programs\Tasks.lnk'; target = $appExe; arguments = '' }
& $accept
$fixtureLink.target = $installRoot + '\Update.exe'
Assert-Throws { & $accept }
$fixtureLink.target = $installRoot + '\other.exe'
Assert-Throws { & $accept }
$fixtureLink.target = $appExe
$fixtureLink.arguments = '--uninstall'
Assert-Throws { & $accept }
$fixtureLink.arguments = ''
$fixtureLink.path = $startMenu + '-sibling\Tasks.lnk'
Assert-Throws { & $accept }
`);
  assert.match(readFileSync(script, 'utf8'), /arguments\s*=\s*\[string\]\$link\.Arguments/);
});

test('native interop C# compiles with actual Add-Type and a correctly sized DWM RECT', { skip: !available }, () => {
  run(extract + String.raw`
$native = $ast.FindAll({param($node)
  $node -is [Management.Automation.Language.StringConstantExpressionAst] -and $node.Value.Contains('namespace TasksInstaller')
}, $true)
if ($native.Count -ne 1) { throw 'Expected exactly one native interop definition' }
Add-Type -TypeDefinition $native[0].Value
if ([Runtime.InteropServices.Marshal]::SizeOf([TasksInstaller.Native+RECT]::new()) -ne 16) { throw 'Invalid RECT ABI' }
if (-not [TasksInstaller.Native].GetMethod('DwmGetWindowAttribute')) { throw 'Missing DWM binding' }
`);
});

test('bounded process helper preserves argument spaces, logs nonzero exits and terminates timeouts', { skip: !available }, () => {
  run(extract + String.raw`
$evidence = Join-Path ([IO.Path]::GetTempPath()) ('bounded-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory $evidence
try {
  $exe = (Get-Process -Id $PID).Path
  $echoScript = Join-Path $evidence 'echo argument.ps1'
  '[Console]::WriteLine($args[0])' | Set-Content -LiteralPath $echoScript
  Invoke-BoundedProcess $exe @('-NoProfile', '-File', $echoScript, 'space value') 'ok' 10
  if ((Get-Content -LiteralPath (Join-Path $evidence 'ok-stdout.txt') -Raw).Trim() -cne 'space value') { throw 'Child did not receive exact argument' }
  $command = Get-Content -LiteralPath (Join-Path $evidence 'ok-command.json') -Raw | ConvertFrom-Json
  if ($command.arguments[-1] -cne 'space value') { throw 'Argument was split' }
  $ok = Get-Content -LiteralPath (Join-Path $evidence 'ok-result.json') -Raw | ConvertFrom-Json
  if ($ok.exitCode -ne 0) { throw 'Success not recorded' }
  Assert-Throws { Invoke-BoundedProcess (Join-Path $evidence 'not-present.exe') @() 'missing' 1 }
  $missing = Get-Content -LiteralPath (Join-Path $evidence 'missing-result.json') -Raw | ConvertFrom-Json
  if ($missing.started -or -not $missing.failure -or $null -ne $missing.exitCode) { throw 'Start failure evidence missing' }
  if (-not (Test-Path -LiteralPath (Join-Path $evidence 'missing-stdout.txt'))) { throw 'Start failure log missing' }
  Assert-Throws { Invoke-BoundedProcess $exe @('-NoProfile', '-Command', '[Console]::Error.WriteLine("expected failure"); exit 7') 'nonzero' 10 }
  $failed = Get-Content -LiteralPath (Join-Path $evidence 'nonzero-result.json') -Raw | ConvertFrom-Json
  if ($failed.exitCode -ne 7) { throw 'Nonzero exit hidden' }
  if ((Get-Content -LiteralPath (Join-Path $evidence 'nonzero-stderr.txt') -Raw) -notmatch 'expected failure') { throw 'stderr lost' }
  Assert-Throws { Invoke-BoundedProcess $exe @('-NoProfile', '-Command', '[Console]::WriteLine("before timeout"); Start-Sleep -Seconds 30') 'timeout' 1 }
  $timed = Get-Content -LiteralPath (Join-Path $evidence 'timeout-result.json') -Raw | ConvertFrom-Json
  if (-not $timed.timedOut) { throw 'Timeout not recorded' }
  if (Get-Process -Id $timed.pid -ErrorAction SilentlyContinue) { throw 'Timed-out process survived' }
  if ((Get-Content -LiteralPath (Join-Path $evidence 'timeout-stdout.txt') -Raw) -notmatch 'before timeout') { throw 'Timeout stdout lost' }
} finally { Remove-Item -LiteralPath $evidence -Recurse -Force }
`);
});

test('profile helpers refuse existing state and never remove nonempty or redirected profiles', { skip: !available }, () => {
  run(extract + String.raw`
$localData = Join-Path ([IO.Path]::GetTempPath()) ('profile-' + [guid]::NewGuid().ToString('N'))
$profile = Join-Path $localData 'EveryoneSoftware/Tasks'
$null = New-Item -ItemType Directory $localData
try {
  Assert-NewProfile $profile $localData
  $null = New-Item -ItemType Directory $profile -Force
  Assert-Throws { Assert-NewProfile $profile $localData }
  'private marker' | Set-Content -LiteralPath (Join-Path $profile 'session.bin')
  Assert-Throws { Remove-EmptyProfile $profile $localData }
  if (-not (Test-Path -LiteralPath (Join-Path $profile 'session.bin'))) { throw 'Session was deleted' }
  Remove-Item -LiteralPath (Join-Path $profile 'session.bin')
  Remove-EmptyProfile $profile $localData
  if (Test-Path -LiteralPath $profile) { throw 'Empty fixture survived' }
  Assert-Throws { Remove-EmptyProfile (Join-Path $localData 'unrelated') $localData }
  Remove-Item -LiteralPath (Join-Path $localData 'EveryoneSoftware')
  $target = Join-Path $localData 'target'; $null = New-Item -ItemType Directory $target
  $null = New-Item -ItemType SymbolicLink -Path (Join-Path $localData 'EveryoneSoftware') -Target $target
  Assert-Throws { Assert-NewProfile $profile $localData }
  Assert-Throws { Remove-EmptyProfile $profile $localData }
} finally { Remove-Item -LiteralPath $localData -Recurse -Force }
`);
});

test('operation budgets reserve failure cleanup time and reject exhausted deadlines', { skip: !available }, () => {
  run(extract + String.raw`
$now = [DateTime]::UtcNow
if ((Get-OperationBudget ($now.AddSeconds(100)) 60 $now) -ne 60) { throw 'Operation limit ignored' }
if ((Get-OperationBudget ($now.AddSeconds(8.8)) 60 $now) -ne 8) { throw 'Deadline exceeded' }
Assert-Throws { Get-OperationBudget ($now.AddSeconds(-1)) 60 $now }
Assert-Throws { Get-OperationBudget ($now.AddMilliseconds(500)) 60 $now }
`);
});

test('cleanup failures are fatal, including silent no-op deletion and failed enumeration', { skip: !available }, () => {
  run(extract + String.raw`
$base = Join-Path ([IO.Path]::GetTempPath()) ('cleanup-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory $base
$root = Join-Path $base ('Tasks-installer-' + ('b' * 32))
$null = New-Item -ItemType Directory $root
try {
  Assert-Throws { Remove-OwnedDirectory $root $base { throw 'denied' } }
  Assert-Throws { Remove-OwnedDirectory $root $base { param($p) } }
  if (-not (Test-Path -LiteralPath $root)) { throw 'No-op test removed fixture' }
  Remove-OwnedDirectory $root $base
  if (Test-Path -LiteralPath $root) { throw 'Real removal did not happen' }
  $summary = @{ status = 'passed'; cleanupErrors = @() }
  Invoke-CleanupAction $summary 'Enumeration' { throw 'cannot enumerate' }
  if ($summary.status -ne 'failed' -or $summary.cleanupErrors.Count -ne 1) { throw 'Cleanup failure was hidden' }
  Invoke-CleanupAction $summary 'Success' { }
  if ($summary.status -ne 'failed') { throw 'Cleanup converted failure to pass' }
  $clean = @{ fileCount = 0; registryCount = 0; shortcutCount = 0; processCount = 0 }
  Assert-RemovedState $clean
  foreach ($field in @('fileCount', 'registryCount', 'shortcutCount', 'processCount')) {
    $dirty = $clean.Clone(); $dirty[$field] = 1
    Assert-Throws { Assert-RemovedState $dirty }
  }
} finally { Remove-Item -LiteralPath $base -Recurse -Force }
`);
});

test('owned fixture scope rejects siblings, traversal, roots and reparse points through actual PowerShell helpers', { skip: !available }, () => {
  assert.ok(existsSync(script), 'lifecycle script must exist');
  run(extract + String.raw`
$base = Join-Path ([IO.Path]::GetTempPath()) ('scope-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $base
try {
  $root = Join-Path $base ('Tasks-installer-' + ('a' * 32))
  Assert-FixtureRoot $root $base
  Assert-Throws { Assert-FixtureRoot $base $base }
  Assert-Throws { Assert-FixtureRoot ($root + '-sibling') $base }
  Assert-Throws { Assert-FixtureRoot (Join-Path $base 'other/../Tasks-installer-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') $base }
  Assert-Throws { Assert-FixtureRoot (Join-Path ($base + '-sibling') ('Tasks-installer-' + ('a' * 32))) $base }
  Assert-Throws { Assert-FixtureRoot 'relative' $base }
  Assert-Throws { Assert-ChildPath $base $base }
  Assert-Throws { Assert-ChildPath ($base + '-sibling/file') $base }
  $target = Join-Path $base 'target'; $null = New-Item -ItemType Directory $target
  $link = Join-Path $base 'link'; $null = New-Item -ItemType SymbolicLink -Path $link -Target $target
  Assert-Throws { Assert-ChildPath (Join-Path $link 'child') $base }
} finally { Remove-Item -LiteralPath $base -Recurse -Force }
`);
});
