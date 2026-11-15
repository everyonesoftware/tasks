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
$compiler = Get-Command ISCC.exe -ErrorAction SilentlyContinue
$compilerPath = if ($null -ne $compiler) { $compiler.Source } else { Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe' }
if (-not (Test-Path -LiteralPath $compilerPath -PathType Leaf)) { throw 'Inno Setup 6 compiler is required on the Windows build host.' }
$compilerVersion = (Get-Item -LiteralPath $compilerPath).VersionInfo.ProductVersion
Write-Host "Inno Setup compiler: $compilerVersion"

$work = Join-Path ([System.IO.Path]::GetTempPath()) ('tasks-installer-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    & (Join-Path $root 'apps/windows/build.ps1') -BuildNumber $BuildNumber
    $publish = Join-Path $root 'apps/windows/artifacts/portable'
    & node $helper validate-payload --directory $publish
    if ($LASTEXITCODE -ne 0) { throw 'Self-contained native payload validation failed.' }
    $fileVersion = (Get-Item -LiteralPath (Join-Path $publish 'Tasks.exe')).VersionInfo.FileVersion
    if ($fileVersion -ne $info.fileVersion) { throw 'Published executable FileVersion does not match the shared build number.' }

    & $compilerPath '/Q' "/DBuildNumber=$BuildNumber" "/DPublishDir=$publish" "/DOutputDir=$work" (Join-Path $root 'apps/windows/installer/Tasks.iss')
    if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compilation failed.' }
    $setup = Join-Path $work $info.filename
    if (-not (Test-Path -LiteralPath $setup -PathType Leaf)) { throw 'Inno Setup did not produce the expected installer.' }
    $output = Join-Path $root 'dist/windows'
    & node $helper stage-installer --setup $setup --directory $output --build-number $BuildNumber
    if ($LASTEXITCODE -ne 0) { throw 'Installer/checksum staging failed. Existing release bytes are never overwritten.' }
    Write-Host "Unsigned Windows installer staged: $output\$($info.filename)"
    Write-Host 'Publication still requires the real install/launch/uninstall gate. No automatic updater is enabled.'
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force
}
