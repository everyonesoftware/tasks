#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BuildNumber,
    [switch]$AllowUnsigned
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $AllowUnsigned) { throw 'Unsigned distribution must be acknowledged explicitly with -AllowUnsigned.' }
if (-not $IsWindows) { throw 'Installer packaging requires a native Windows publish; Linux compile-only output cannot be distributed.' }

$root = Split-Path $PSScriptRoot -Parent
$helper = Join-Path $PSScriptRoot 'windows-package.mjs'
$infoJson = & node $helper info --build-number $BuildNumber
if ($LASTEXITCODE -ne 0) { throw 'Could not verify the shared build/source identity.' }
$info = $infoJson | ConvertFrom-Json
$dirty = & git -C $root status --porcelain --untracked-files=all -- apps/windows scripts .config .github/workflows/publish.yml
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Release inputs must be committed and clean.' }
$compiler = Get-Command ISCC.exe -ErrorAction SilentlyContinue
$compilerPath = if ($null -ne $compiler) { $compiler.Source } else { Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe' }
if (-not (Test-Path -LiteralPath $compilerPath -PathType Leaf)) { throw 'Inno Setup 6 is required for the unregistered legacy migration guard.' }
$work = Join-Path ([System.IO.Path]::GetTempPath()) ('tasks-installer-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
Push-Location $root
try {
    dotnet tool restore --tool-manifest (Join-Path $root '.config/dotnet-tools.json')
    if ($LASTEXITCODE -ne 0) { throw 'Pinned Velopack 1.2.161 tool restore failed.' }
    & (Join-Path $root 'apps/windows/build.ps1') -BuildNumber $BuildNumber
    $publish = Join-Path $root 'apps/windows/artifacts/portable'
    & node $helper validate-payload --directory $publish
    if ($LASTEXITCODE -ne 0) { throw 'Self-contained native payload validation failed.' }
    $fileVersion = (Get-Item -LiteralPath (Join-Path $publish 'Tasks.exe')).VersionInfo.FileVersion
    if ($fileVersion -ne $info.fileVersion) { throw 'Published executable FileVersion does not match the shared build number.' }
    $releases = Join-Path $work 'velopack'
    $packArguments = @('tool', 'run', 'vpk', '--', '[win]', 'pack', '--packId', 'TasksWindows', '--packVersion', $info.version,
        '--packDir', $publish, '--mainExe', 'Tasks.exe', '--packTitle', 'Tasks', '--packAuthors', 'Everyone Software',
        '--runtime', 'win-x64', '--channel', 'win-x64', '--framework', 'vcredist143-x64', '--noPortable', '--delta', 'None',
        '--shortcuts', 'StartMenuRoot', '--outputDir', $releases, '--noDefaultExclude', '--exclude', '(?!)', '--yes', '--skip-updates')
    & dotnet @packArguments
    if ($LASTEXITCODE -ne 0) { throw 'Velopack packaging failed.' }
    & (Join-Path $PSScriptRoot 'validate-windows-nupkg.ps1') -PackagePath (Join-Path $releases "TasksWindows-$($info.version)-win-x64-full.nupkg") -PublishDirectory $publish -Version $info.version
    $rawSetup = Join-Path $releases 'TasksWindows-win-x64-Setup.exe'
    $rawSetupSha256 = (Get-FileHash -LiteralPath $rawSetup -Algorithm SHA256).Hash
    $guardOutput = Join-Path $work 'guard'
    & $compilerPath '/Q' "/DBuildNumber=$BuildNumber" "/DRawSetup=$rawSetup" "/DRawSetupSha256=$rawSetupSha256" "/DOutputDir=$guardOutput" (Join-Path $root 'apps/windows/installer/Tasks.iss')
    if ($LASTEXITCODE -ne 0) { throw 'Migration guard compilation failed.' }
    $afterJson = & node $helper info --build-number $BuildNumber
    if ($LASTEXITCODE -ne 0 -or ($afterJson | ConvertFrom-Json).sourceSha -ne $info.sourceSha) { throw 'Source identity changed while building.' }
    $dirty = & git -C $root status --porcelain --untracked-files=all -- apps/windows scripts .config .github/workflows/publish.yml
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Release inputs changed while building.' }
    $output = Join-Path $root 'dist/windows'
    & node $helper stage-velopack --source $releases --guard (Join-Path $guardOutput $info.filename) --directory $output --build-number $BuildNumber
    if ($LASTEXITCODE -ne 0) { throw 'Velopack inventory staging failed. Existing release bytes are never overwritten.' }
    Write-Host "Guarded unsigned Velopack inventory staged: $output"
    Write-Host 'Existing Inno installs are refused: one-time manual uninstall retains the protected session. Native install/render/close/uninstall acceptance is still required.'
}
finally {
    Pop-Location
    Remove-Item -LiteralPath $work -Recurse -Force
}
