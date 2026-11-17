#requires -Version 7.0
[CmdletBinding()]
param([string]$BuildNumber)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'This is a native Windows publish. Use the documented compile-only check on Linux.' }

$helper = Join-Path $PSScriptRoot '../../scripts/windows-package.mjs'
$identityArguments = @('info')
if ($PSBoundParameters.ContainsKey('BuildNumber')) { $identityArguments += @('--build-number', $BuildNumber) }
$identityJson = & node $helper @identityArguments
if ($LASTEXITCODE -ne 0) { throw 'Could not verify the Windows build/source identity.' }
$identity = $identityJson | ConvertFrom-Json

Push-Location $PSScriptRoot
$staging = $null
try {
    dotnet test Tasks.Storage.Tests/Tasks.Storage.Tests.csproj -c Release
    if ($LASTEXITCODE -ne 0) { throw 'Session storage tests failed.' }
    dotnet test Tasks.Core.Tests/Tasks.Core.Tests.csproj -c Release
    if ($LASTEXITCODE -ne 0) { throw 'Core tests failed.' }

    dotnet test Tasks.Update.Tests/Tasks.Update.Tests.csproj -c Release
    if ($LASTEXITCODE -ne 0) { throw 'Velopack updater tests failed.' }

    $artifacts = Join-Path $PSScriptRoot 'artifacts'
    New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
    $staging = Join-Path $artifacts ('.publish-' + [Guid]::NewGuid().ToString('N'))
    dotnet publish Tasks.App/Tasks.App.csproj -c Release -r win-x64 --self-contained true -p:WindowsAppSDKSelfContained=true -o $staging "-p:Version=$($identity.version)" "-p:FileVersion=$($identity.fileVersion)" "-p:InformationalVersion=$($identity.version)+$($identity.sourceSha)" -p:IncludeSourceRevisionInInformationalVersion=false -p:DebugType=None -p:DebugSymbols=false
    if ($LASTEXITCODE -ne 0) { throw 'Native Windows publish failed.' }
    foreach ($required in @('Tasks.exe', 'Tasks.dll', 'resources.pri', 'Microsoft.UI.Xaml.dll', 'Microsoft.WindowsAppRuntime.dll', 'coreclr.dll')) {
        if (-not (Test-Path -LiteralPath (Join-Path $staging $required) -PathType Leaf)) {
            throw "Native publish is incomplete: missing $required. Do not distribute this folder."
        }
    }
    & node $helper validate-payload --directory $staging
    if ($LASTEXITCODE -ne 0) { throw 'Native payload integrity/architecture validation failed.' }
    $output = Join-Path $artifacts 'portable'
    if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Recurse -Force }
    Move-Item -LiteralPath $staging -Destination $output
    $staging = $null
    Write-Host "Development folder built: $output (build $($identity.buildNumber), $($identity.sourceSha))"
    Write-Host 'Keep the entire folder together. Native launch, Windows data protection, and installer acceptance remain separate gates.'
}
finally {
    if ($null -ne $staging -and (Test-Path -LiteralPath $staging)) { Remove-Item -LiteralPath $staging -Recurse -Force }
    Pop-Location
}
