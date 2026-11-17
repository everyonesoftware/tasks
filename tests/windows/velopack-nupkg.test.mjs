import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const script = fileURLToPath(new URL('../../scripts/validate-windows-nupkg.ps1', import.meta.url));
const pwsh = process.env.PWSH || '/opt/data/tools/powershell-7.5.4/pwsh';

test('real ZIP validator checks package identity, required native bytes, traversal and collisions', { skip: !existsSync(pwsh) && process.platform !== 'win32' }, () => {
  assert.ok(existsSync(script), 'native package ZIP validation is missing');
  const code = String.raw`
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($env:VALIDATOR, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($fn in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) { . ([scriptblock]::Create($fn.Extent.Text)) }
$root = Join-Path ([IO.Path]::GetTempPath()) ('tasks-zip-' + [guid]::NewGuid().ToString('N'))
$publish = Join-Path $root 'publish'; $null = New-Item -ItemType Directory $publish -Force
$required = @('Tasks.exe', 'Tasks.dll', 'resources.pri', 'Microsoft.UI.Xaml.dll', 'Microsoft.WindowsAppRuntime.dll', 'coreclr.dll', 'Tasks.Core.dll', 'fr/Tasks.resources.dll')
foreach ($name in $required) {
  $path = Join-Path $publish $name
  $null = New-Item -ItemType Directory ([IO.Path]::GetDirectoryName($path)) -Force
  [IO.File]::WriteAllBytes($path, [byte[]](1,2,3))
}
function Make-Zip([string]$Mode) {
  $file = Join-Path $root ($Mode + '.nupkg')
  $zip = [IO.Compression.ZipFile]::Open($file, [IO.Compression.ZipArchiveMode]::Create)
  try {
    $version = if ($Mode -eq 'identity') { '0.1.138' } else { '0.1.137' }
    $entry = $zip.CreateEntry('TasksWindows.nuspec'); $writer = [IO.StreamWriter]::new($entry.Open())
    try { $writer.Write('<package><metadata><id>TasksWindows</id><version>' + $version + '</version><rid>win-x64</rid><mainExe>Tasks.exe</mainExe><channel>win-x64</channel></metadata></package>') } finally { $writer.Dispose() }
    foreach ($name in $required) {
      if ($Mode -eq 'missing' -and $name -eq 'Tasks.Core.dll') { continue }
      $entry = $zip.CreateEntry('lib/app/' + $name); $stream = $entry.Open()
      try {
        [byte[]]$bytes = if ($Mode -eq 'corrupt' -and $name -eq 'fr/Tasks.resources.dll') { [byte[]](9,2,3) } else { [byte[]](1,2,3) }
        $stream.Write($bytes)
      } finally { $stream.Dispose() }
    }
    if ($Mode -eq 'extra') { $null = $zip.CreateEntry('lib/app/unexpected.dll') }
    if ($Mode -eq 'nested-generated') { $null = $zip.CreateEntry('lib/app/fr/Squirrel.exe') }
    if ($Mode -eq 'generated') {
      foreach ($name in @('sq.version', 'Squirrel.exe', 'Tasks_ExecutionStub.exe')) {
        $entry = $zip.CreateEntry('lib/app/' + $name); $stream = $entry.Open()
        try { $stream.Write([byte[]](4,5,6)) } finally { $stream.Dispose() }
      }
    }
    if ($Mode -eq 'traversal') { $null = $zip.CreateEntry('lib/app/../outside') }
    if ($Mode -eq 'duplicate') { $null = $zip.CreateEntry('lib/app/TASKS.exe') }
  } finally { $zip.Dispose() }
  return $file
}
try {
  Assert-VelopackPackage (Make-Zip 'good') $publish '0.1.137'
  Assert-VelopackPackage (Make-Zip 'generated') $publish '0.1.137'
  foreach ($case in @(
    @('identity', 'Incorrect Velopack package identity'), @('missing', 'Missing package/publish file: Tasks.Core.dll'),
    @('corrupt', 'Package/publish byte mismatch: fr/Tasks.resources.dll'), @('extra', 'Unexpected package payload: unexpected.dll'),
    @('nested-generated', 'Unexpected package payload: fr/Squirrel.exe'), @('traversal', 'Unsafe package ZIP member'),
    @('duplicate', 'Duplicate case-folded package ZIP member')
  )) {
    $message = ''; try { Assert-VelopackPackage (Make-Zip $case[0]) $publish '0.1.137' } catch { $message = $_.Exception.Message }
    if ($message -cne $case[1]) { throw ('Mode ' + $case[0] + ': expected ' + $case[1] + ', got ' + $message) }
  }
  [IO.File]::WriteAllBytes((Join-Path $publish 'Tasks.dll'), [byte[]](9,9,9))
  $threw = $false; try { Assert-VelopackPackage (Join-Path $root 'good.nupkg') $publish '0.1.137' } catch { $threw = $true }
  if (-not $threw) { throw 'Accepted byte mismatch' }
} finally { Remove-Item -LiteralPath $root -Recurse -Force }
`;
  const result = spawnSync(existsSync(pwsh) ? pwsh : 'pwsh', ['-NoLogo', '-NoProfile', '-Command', code], { encoding: 'utf8', timeout: 30000, env: { ...process.env, VALIDATOR: script } });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr);
});
