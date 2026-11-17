#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PackagePath,
    [Parameter(Mandatory)][string]$PublishDirectory,
    [Parameter(Mandatory)][string]$Version
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-VelopackPackage([string]$PackagePath, [string]$PublishDirectory, [string]$Version) {
    $zip = [IO.Compression.ZipFile]::OpenRead($PackagePath)
    try {
        $members = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName
            if ($name -match '\\|(^|/)\.\.?(/|$)|^/|:' -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000) { throw 'Unsafe package ZIP member' }
            if (-not $members.TryAdd($name, $entry)) { throw 'Duplicate case-folded package ZIP member' }
        }
        if (-not $members.ContainsKey('TasksWindows.nuspec')) { throw 'Missing package identity' }
        $settings = [Xml.XmlReaderSettings]::new(); $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit; $settings.XmlResolver = $null
        $stream = $members['TasksWindows.nuspec'].Open()
        try {
            $reader = [Xml.XmlReader]::Create($stream, $settings)
            try { $xml = [xml]::new(); $xml.XmlResolver = $null; $xml.Load($reader) } finally { $reader.Dispose() }
        } finally { $stream.Dispose() }
        $metadata = $xml.DocumentElement.SelectSingleNode("*[local-name()='metadata']")
        foreach ($pair in @(@('id', 'TasksWindows'), @('version', $Version), @('rid', 'win-x64'), @('channel', 'win-x64'), @('mainExe', 'Tasks.exe'))) {
            $node = $metadata.SelectSingleNode("*[local-name()='$($pair[0])']")
            if ($null -eq $node -or $node.InnerText -cne $pair[1]) { throw 'Incorrect Velopack package identity' }
        }
        foreach ($name in @('Tasks.exe', 'Tasks.dll', 'resources.pri', 'Microsoft.UI.Xaml.dll', 'Microsoft.WindowsAppRuntime.dll', 'coreclr.dll')) {
            $key = 'lib/app/' + $name
            if (-not $members.ContainsKey($key) -or $members[$key].Length -le 0) { throw "Missing native package payload: $name" }
        }
        $publishRoot = (Get-Item -LiteralPath $PublishDirectory -Force).FullName
        $published = [Collections.Generic.Dictionary[string, object]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($file in Get-ChildItem -LiteralPath $publishRoot -Recurse -Force -ErrorAction Stop) {
            if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe publish reparse point' }
            if ($file.PSIsContainer) { continue }
            $name = [IO.Path]::GetRelativePath($publishRoot, $file.FullName).Replace('\', '/')
            if (-not $published.TryAdd($name, $file)) { throw 'Duplicate case-folded publish file' }
        }
        foreach ($name in $published.Keys) {
            $key = 'lib/app/' + $name
            if (-not $members.ContainsKey($key)) { throw "Missing package/publish file: $name" }
            $stream = $members[$key].Open()
            try { $actual = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) } finally { $stream.Dispose() }
            $expected = (Get-FileHash -LiteralPath $published[$name].FullName -Algorithm SHA256).Hash
            if ($members[$key].Length -ne $published[$name].Length -or $actual -cne $expected) { throw "Package/publish byte mismatch: $name" }
        }
        # vpk 1.2.161 WindowsPackCommandRunner.PreprocessPackDir creates exactly
        # these root-level files: manifest, updater and packTitle execution stub.
        # Never exempt a published file from the byte comparison above.
        $generated = @('sq.version', 'Squirrel.exe', 'Tasks_ExecutionStub.exe')
        foreach ($entry in $zip.Entries) {
            if (-not $entry.FullName.StartsWith('lib/app/', [StringComparison]::OrdinalIgnoreCase) -or $entry.FullName.EndsWith('/')) { continue }
            $name = $entry.FullName.Substring('lib/app/'.Length)
            if (-not $published.ContainsKey($name) -and $name -cnotin $generated) { throw "Unexpected package payload: $name" }
        }
    } finally { $zip.Dispose() }
}
Assert-VelopackPackage $PackagePath $PublishDirectory $Version
