#Requires -Version 7.2
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$InstallerPath,
    [Parameter(Mandatory)][string]$EvidenceDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-ChildPath([string]$Path, [string]$Parent) {
    foreach ($value in @($Path, $Parent)) {
        if (-not [IO.Path]::IsPathFullyQualified($value) -or $value -match '(^|[\\/])\.\.?([\\/]|$)') {
            throw 'Only absolute, traversal-free paths are permitted'
        }
    }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $base = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if (-not $full.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Path is outside the owned directory'
    }
    # Check every existing ancestor, including the runner root: never follow junctions/symlinks.
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Reparse points are not owned paths'
            }
        }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
}
function Assert-NewProfile([string]$Profile, [string]$LocalData) {
    Assert-ChildPath $Profile $LocalData
    if (Test-Path -LiteralPath $Profile) { throw 'Preexisting Tasks profile/session; refusing personal state' }
}
function Remove-EmptyProfile([string]$Profile, [string]$LocalData) {
    Assert-ChildPath $Profile $LocalData
    $expected = Join-Path (Join-Path $LocalData 'EveryoneSoftware') 'Tasks'
    if ($Profile -ine $expected) { throw 'Refusing unrelated profile path' }
    if (Test-Path -LiteralPath $Profile) {
        if (@(Get-ChildItem -LiteralPath $Profile -Force -ErrorAction Stop).Count) { throw 'Refusing nonempty profile removal' }
        [IO.Directory]::Delete($Profile, $false)
        if (Test-Path -LiteralPath $Profile) { throw 'Empty profile directory survived cleanup' }
    }
}
function Get-OperationBudget([DateTime]$Deadline, [int]$MaximumSeconds, [DateTime]$Now = [DateTime]::UtcNow) {
    $seconds = [Math]::Floor(($Deadline - $Now).TotalSeconds)
    if ($seconds -lt 1) { throw 'Lifecycle deadline exhausted; reserving failure cleanup time' }
    [int][Math]::Min($MaximumSeconds, $seconds)
}
function Invoke-CleanupAction($Summary, [string]$Label, [scriptblock]$Action) {
    try { & $Action } catch {
        $Summary.cleanupErrors += "${Label}: $_"
        $Summary.status = 'failed'
    }
}
function Remove-OwnedDirectory([string]$Root, [string]$RunnerTemp, [scriptblock]$Remove = {
    param($Target) Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction Stop
}) {
    Assert-FixtureRoot $Root $RunnerTemp
    if (Test-Path -LiteralPath $Root) {
        # Reject nested junctions too, before recursive deletion.
        foreach ($item in Get-ChildItem -LiteralPath $Root -Recurse -Force -ErrorAction Stop) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point in fixture' }
        }
        & $Remove $Root
    }
    if (Test-Path -LiteralPath $Root) { throw 'Owned directory survived cleanup' }
}
function Assert-RemovedState($State) {
    if ($State.fileCount -or $State.registryCount -or $State.shortcutCount -or $State.processCount) {
        throw 'Uninstall left payload, registration, shortcuts or owned processes'
    }
}
function Assert-FixtureRoot([string]$Root, [string]$RunnerTemp) {
    Assert-ChildPath $Root $RunnerTemp
    if ([IO.Path]::GetDirectoryName($Root) -ine $RunnerTemp.TrimEnd([IO.Path]::DirectorySeparatorChar) -or
        [IO.Path]::GetFileName($Root) -cnotmatch '^Tasks-installer-[a-f0-9]{32}$') {
        throw 'Install root must be a direct, unique Tasks fixture under RUNNER_TEMP'
    }
}

# Native-only acceptance. The caller MUST also put a hard five-minute timeout on
# this step (COM/OS calls cannot all be interrupted by a PowerShell deadline).
function Write-Json($Value, [string]$Name) {
    ConvertTo-Json -InputObject $Value -Depth 6 | Set-Content -LiteralPath (Join-Path $evidence $Name) -Encoding utf8
}
function Get-Registrations {
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
            $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
            try {
                $key = $base.OpenSubKey($uninstallKey)
                if ($null -eq $key) { continue }
                try {
                    # Only scalars: no recursive PowerShell registry-provider metadata.
                    [pscustomobject]@{ hive = $hive.ToString(); view = $view.ToString()
                        DisplayName = [string]$key.GetValue('DisplayName'); DisplayVersion = [string]$key.GetValue('DisplayVersion')
                        InstallLocation = [string]$key.GetValue('InstallLocation'); UninstallString = [string]$key.GetValue('UninstallString') }
                } finally { $key.Dispose() }
            } finally { $base.Dispose() }
        }
    }
}
function Get-OwnedProcesses {
    if (-not $installRoot) { return }
    Assert-FixtureRoot $installRoot $runnerTemp
    Get-CimInstance Win32_Process -OperationTimeoutSec 5 -ErrorAction Stop | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase)
    } | Select-Object ProcessId, ExecutablePath
}
function Stop-OwnedProcesses {
    foreach ($owned in @(Get-OwnedProcesses)) {
        $process = Get-Process -Id $owned.ProcessId -ErrorAction SilentlyContinue
        if ($process -and $process.Path -ieq $owned.ExecutablePath) {
            $process.Kill($true)
            if (-not $process.WaitForExit(5000)) { throw 'Owned process survived failure cleanup' }
        }
    }
}
function Get-TaskLinks {
    $shell = New-Object -ComObject WScript.Shell
    try {
        foreach ($root in @([Environment]::GetFolderPath('StartMenu'), [Environment]::GetFolderPath('CommonStartMenu'),
            [Environment]::GetFolderPath('DesktopDirectory'), [Environment]::GetFolderPath('CommonDesktopDirectory')) | Select-Object -Unique) {
            if (-not $root -or -not (Test-Path -LiteralPath $root)) { continue }
            foreach ($file in Get-ChildItem -LiteralPath $root -Filter '*.lnk' -Recurse -File -ErrorAction Stop) {
                $link = $shell.CreateShortcut($file.FullName)
                try {
                    $target = [string]$link.TargetPath
                    if ($file.Name -ieq 'Tasks.lnk' -or ($installRoot -and $target.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase))) {
                        [pscustomobject]@{ path = $file.FullName; target = $target }
                    }
                } finally { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) }
            }
        }
    } finally { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) }
}
function Get-RemainingInstallation {
    $files = @()
    Assert-FixtureRoot $installRoot $runnerTemp
    if (Test-Path -LiteralPath $installRoot) {
        $files = @(Get-ChildItem -LiteralPath $installRoot -File -Recurse -Force -ErrorAction Stop | Select-Object FullName, Length)
    }
    $registrations = @(Get-Registrations); $links = @(Get-TaskLinks); $processes = @(Get-OwnedProcesses)
    Write-Json @{ files = $files; registrations = $registrations; shortcuts = $links; processes = $processes } 'remaining.json'
    @{ fileCount = $files.Count; registryCount = $registrations.Count; shortcutCount = $links.Count; processCount = $processes.Count }
}
function Invoke-BoundedProcess([string]$Executable, [string[]]$Arguments, [string]$Label, [int]$Seconds = 60) {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable; $info.WorkingDirectory = $evidence; $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    Write-Json @{ executable = $Executable; arguments = $Arguments } "$Label-command.json"
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
    $launched = $false; $stdout = $null; $stderr = $null; $timedOut = $false; $failure = $null; $exitCode = $null
    try {
        if (-not $process.Start()) { throw "Cannot start $Label" }
        $launched = $true
        $stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($Seconds * 1000)) {
            $timedOut = $true
            throw "$Label process timeout"
        }
        if ($process.ExitCode -ne 0) { throw "$Label exited $($process.ExitCode)" }
    } catch { $failure = $_.ToString() } finally {
        try {
            # This is failure cleanup, never evidence of successful lifecycle completion.
            if ($launched -and -not $process.HasExited) {
                $process.Kill($true)
                if (-not $process.WaitForExit(5000)) { throw "$Label process survived cleanup" }
            }
        } catch { $failure = "$failure; process cleanup: $_" }
        try {
            if ($launched -and $process.HasExited) { $exitCode = $process.ExitCode }
            foreach ($stream in @(@{ task = $stdout; name = 'stdout' }, @{ task = $stderr; name = 'stderr' })) {
                $text = ''
                try {
                    if ($null -ne $stream.task) {
                        if ($stream.task.Wait(2000)) { $text = $stream.task.Result }
                        else { throw "$Label log stream did not close" }
                    }
                } catch { $failure = "$failure; log capture: $_" }
                $text | Set-Content -LiteralPath (Join-Path $evidence "$Label-$($stream.name).txt")
            }
            Write-Json @{ pid = $(if ($launched) { $process.Id } else { $null }); started = $launched
                exitCode = $exitCode; timedOut = $timedOut; failure = $failure } "$Label-result.json"
        } finally { $process.Dispose() }
    }
    if ($failure) { throw $failure }
}
function Initialize-Native {
    # Keep System.Drawing in PowerShell, not an implicitly referenced C# assembly.
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
namespace TasksInstaller {
    public class Window {
        public IntPtr Handle; public string Title; public int Pid;
        public bool Responsive; public int Width; public int Height;
    }
    public static class Native {
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
        [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr extra);
        [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
        [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
        [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
        [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT rect, int size);
        [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
        [DllImport("user32.dll")] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
        [DllImport("user32.dll")] public static extern bool SwitchDesktop(IntPtr desktop);
        [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int command);
        [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
        public static Window[] Find(int pid) {
            var found = new List<Window>();
            EnumWindows((h, ignored) => {
                uint owner; GetWindowThreadProcessId(h, out owner);
                if (owner != pid || !IsWindowVisible(h)) return true;
                var text = new StringBuilder(1024); GetWindowText(h, text, text.Capacity);
                RECT rect; if (!GetWindowRect(h, out rect)) return true;
                UIntPtr result;
                bool responsive = SendMessageTimeout(h, 0, UIntPtr.Zero, IntPtr.Zero, 0x0002, 500, out result) != IntPtr.Zero;
                found.Add(new Window { Handle=h, Title=text.ToString(), Pid=pid, Responsive=responsive, Width=rect.Right-rect.Left, Height=rect.Bottom-rect.Top });
                return true;
            }, IntPtr.Zero);
            return found.ToArray();
        }
    }
}
'@
    $null = [TasksInstaller.Native]::SetThreadDpiAwarenessContext([IntPtr]::new(-4))
    $desktop = [TasksInstaller.Native]::OpenInputDesktop(0, $false, 0x0100)
    if ($desktop -eq [IntPtr]::Zero) { throw 'No accessible input desktop' }
    try { if (-not [TasksInstaller.Native]::SwitchDesktop($desktop)) { throw 'Locked/noninteractive desktop' } }
    finally { $null = [TasksInstaller.Native]::CloseDesktop($desktop) }
}
function Save-WindowScreenshot($Candidate) {
    $null = [TasksInstaller.Native]::ShowWindow($Candidate.Handle, 3)
    $null = [TasksInstaller.Native]::SetForegroundWindow($Candidate.Handle)
    Start-Sleep -Milliseconds 750
    if ([TasksInstaller.Native]::GetForegroundWindow() -ne $Candidate.Handle) { throw 'Foreground ownership not established' }
    $rect = [TasksInstaller.Native+RECT]::new()
    if ([TasksInstaller.Native]::DwmGetWindowAttribute($Candidate.Handle, 9, [ref]$rect, [Runtime.InteropServices.Marshal]::SizeOf($rect)) -ne 0) {
        throw 'DWM visible frame bounds unavailable'
    }
    $bounds = [Windows.Forms.SystemInformation]::VirtualScreen
    $width = $rect.Right - $rect.Left; $height = $rect.Bottom - $rect.Top
    if ($width -lt 200 -or $height -lt 200 -or $rect.Left -lt $bounds.Left -or $rect.Top -lt $bounds.Top -or
        $rect.Right -gt $bounds.Right -or $rect.Bottom -gt $bounds.Bottom) { throw 'Offscreen/invalid visible frame' }
    $bitmap = [Drawing.Bitmap]::new($width, $height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
        $colors = [Collections.Generic.HashSet[int]]::new()
        for ($x = 12; $x -lt $width - 12; $x += 13) {
            # Exclude the title bar: window chrome alone is not rendered app content.
            for ($y = 80; $y -lt $height - 12; $y += 13) { $null = $colors.Add($bitmap.GetPixel($x, $y).ToArgb()) }
        }
        $bitmap.Save((Join-Path $evidence 'window.png'), [Drawing.Imaging.ImageFormat]::Png)
        if ($colors.Count -lt 8) { throw 'Blank app content: insufficient screenshot pixel variation' }
        if ([TasksInstaller.Native]::GetForegroundWindow() -ne $Candidate.Handle) { throw 'Foreground changed during capture' }
        Write-Json @{ width = $width; height = $height; sampledColors = $colors.Count; handle = $Candidate.Handle.ToInt64() } 'screenshot.json'
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
}

$started = [DateTime]::UtcNow
$lifecycleDeadline = $started.AddSeconds(200) # reserve the rest of the five-minute step for cleanup/evidence
$summary = [ordered]@{ schemaVersion = 1; status = 'failed'; startedUtc = $started.ToString('o')
    installerSha256 = $null; installRoot = $null; installVerified = $false; windowVerified = $false
    gracefulCloseVerified = $false; uninstallVerified = $false; screenshotSha256 = $null
    cleanupErrors = @(); failure = $null }
$installRoot = $null; $profile = $null; $mutationStarted = $false; $transcriptStarted = $false; $app = $null
$uninstallKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{d65cbd98-53e5-47a0-8c65-fcc03f2df1ac}_is1'
$runnerTemp = $env:RUNNER_TEMP
# Evidence can be written on Linux for an honest fail-closed result, but must
# always be scoped to a real runner temp and must never overwrite diagnostics.
if (-not $runnerTemp -or -not [IO.Path]::IsPathFullyQualified($runnerTemp) -or -not (Test-Path -LiteralPath $runnerTemp -PathType Container)) {
    throw 'A valid absolute RUNNER_TEMP directory is required'
}
Assert-ChildPath $EvidenceDirectory $runnerTemp
$evidence = [IO.Path]::GetFullPath($EvidenceDirectory)
if ((Test-Path -LiteralPath $evidence) -and @(Get-ChildItem -LiteralPath $evidence -Force).Count) { throw 'EvidenceDirectory must be empty/new' }
$null = New-Item -ItemType Directory -Path $evidence -Force
try {
    Start-Transcript -LiteralPath (Join-Path $evidence 'transcript.log') | Out-Null
    $transcriptStarted = $true
    if (-not $IsWindows) { throw 'Native Windows is required; Linux/WSL cannot pass this gate' }
    if ($env:GITHUB_ACTIONS -cne 'true') { throw 'Only an ephemeral GitHub Actions Windows runner is permitted' }
    if (-not [Environment]::UserInteractive -or (Get-Process -Id $PID).SessionId -eq 0) { throw 'Interactive non-session-0 desktop required' }
    $installer = (Resolve-Path -LiteralPath $InstallerPath).Path
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf) -or [IO.Path]::GetExtension($installer) -ine '.exe') { throw 'InstallerPath must be the real Setup.exe' }
    $summary.installerSha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
    $installRoot = Join-Path $runnerTemp ('Tasks-installer-' + [guid]::NewGuid().ToString('N'))
    Assert-FixtureRoot $installRoot $runnerTemp
    if (Test-Path -LiteralPath $installRoot) { throw 'Fixture collision' }
    $summary.installRoot = $installRoot
    $localData = [Environment]::GetFolderPath('LocalApplicationData')
    $profile = Join-Path $localData 'EveryoneSoftware\Tasks'
    Assert-NewProfile $profile $localData
    $defaultInstall = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs\Tasks'
    if (Test-Path -LiteralPath $defaultInstall) { throw 'Preexisting default Tasks install' }
    if (@(Get-Registrations).Count) { throw 'Preexisting HKCU/HKLM Tasks registration' }
    if (@(Get-TaskLinks).Count) { throw 'Preexisting Tasks shortcut' }
    Initialize-Native
    Write-Json @{ os = [Environment]::OSVersion.VersionString; sessionId = (Get-Process -Id $PID).SessionId
        powershell = $PSVersionTable.PSVersion.ToString(); runnerImage = $env:ImageOS } 'environment.json'
    $mutationStarted = $true
    Invoke-BoundedProcess $installer @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', "/DIR=$installRoot", "/LOG=$(Join-Path $evidence 'install.log')") 'install' (Get-OperationBudget $lifecycleDeadline 60)
    $appExe = Join-Path $installRoot 'Tasks.exe'
    $uninstaller = Join-Path $installRoot 'unins000.exe'
    foreach ($relative in @('Tasks.exe', 'Tasks.dll', 'resources.pri', 'Microsoft.UI.Xaml.dll', 'Microsoft.WindowsAppRuntime.dll', 'coreclr.dll', 'unins000.exe')) {
        $file = Get-Item -LiteralPath (Join-Path $installRoot $relative)
        if ($file.PSIsContainer -or $file.Length -le 0) { throw "Missing/empty payload: $relative" }
    }
    Write-Json @(Get-ChildItem -LiteralPath $installRoot -Recurse -File | Select-Object FullName, Length) 'installed-files.json'
    $registrations = @(Get-Registrations)
    if (-not $registrations.Count) { throw 'Missing Inno registration' }
    foreach ($entry in $registrations) {
        if ($entry.hive -ne 'CurrentUser' -or $entry.InstallLocation.TrimEnd('\') -ine $installRoot) { throw 'Incorrect per-user install registration' }
    }
    Write-Json @($registrations | Select-Object DisplayName, DisplayVersion, InstallLocation, UninstallString) 'registration.json'
    $links = @(Get-TaskLinks)
    Write-Json $links 'installed-shortcuts.json'
    if (-not @($links | Where-Object { $_.target -ieq $appExe -and $_.path.StartsWith([Environment]::GetFolderPath('StartMenu') + '\', [StringComparison]::OrdinalIgnoreCase) }).Count) {
        throw 'No per-user Start menu shortcut targets exact installed Tasks.exe'
    }
    if (Test-Path -LiteralPath $profile) { throw 'Profile unexpectedly created before first launch' }
    $summary.installVerified = $true
    $app = Start-Process -FilePath $appExe -WorkingDirectory $evidence -PassThru `
        -RedirectStandardOutput (Join-Path $evidence 'app-stdout.txt') -RedirectStandardError (Join-Path $evidence 'app-stderr.txt')
    $appPid = $app.Id; $window = $null; $stableSamples = 0; $lastHandle = [IntPtr]::Zero
    $deadline = [DateTime]::UtcNow.AddSeconds((Get-OperationBudget $lifecycleDeadline 40))
    $observations = [Collections.Generic.List[object]]::new()
    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not @(Get-OwnedProcesses | Where-Object { $_.ProcessId -eq $appPid -and $_.ExecutablePath -ieq $appExe }).Count) { throw 'Exact installed Tasks.exe exited before window acceptance' }
        $candidate = $null
        foreach ($item in @([TasksInstaller.Native]::Find($appPid))) {
            $observations.Add(@{ handle = $item.Handle.ToInt64(); responsive = $item.Responsive; width = $item.Width; height = $item.Height; title = $item.Title })
            if ($item.Title -eq 'Tasks' -and $item.Responsive -and $item.Width -ge 200 -and $item.Height -ge 200) { $candidate = $item }
        }
        Write-Json @($observations.ToArray()) 'window-observations.json'
        if ($candidate) {
            if ($candidate.Handle -eq $lastHandle) { $stableSamples++ } else { $stableSamples = 1 }
            $lastHandle = $candidate.Handle
            if ($stableSamples -ge 3) { $window = $candidate; break }
        } else { $stableSamples = 0; $lastHandle = [IntPtr]::Zero }
        Start-Sleep -Milliseconds 750
    }
    if (-not $window) { throw 'No real visible responsive Tasks window' }
    Write-Json @{ pid = $appPid; executable = $appExe; handle = $window.Handle.ToInt64(); responsiveSamples = $stableSamples } 'window.json'
    Save-WindowScreenshot $window
    $summary.screenshotSha256 = (Get-FileHash -LiteralPath (Join-Path $evidence 'window.png') -Algorithm SHA256).Hash
    if (-not @([TasksInstaller.Native]::Find($appPid) | Where-Object { $_.Handle -eq $window.Handle -and $_.Responsive }).Count) { throw 'App unresponsive after screenshot' }
    if ((Test-Path -LiteralPath $profile) -and @(Get-ChildItem -LiteralPath $profile -Force).Count) { throw 'Signed-out app persisted unexpected profile/session content' }
    $summary.windowVerified = $true
    if (-not [TasksInstaller.Native]::PostMessage($window.Handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'WM_CLOSE failed' }
    $closeDeadline = [DateTime]::UtcNow.AddSeconds((Get-OperationBudget $lifecycleDeadline 12))
    while (@(Get-OwnedProcesses).Count -and [DateTime]::UtcNow -lt $closeDeadline) { Start-Sleep -Milliseconds 250 }
    if (@(Get-OwnedProcesses).Count) { throw 'Graceful close failed; forced termination is failure cleanup only' }
    $app.Refresh()
    Write-Json @{ pid = $appPid; hasExited = $app.HasExited; exitCode = $app.ExitCode } 'app-exit.json'
    if ($app.ExitCode -ne 0) { throw 'App exited abnormally after close' }
    $summary.gracefulCloseVerified = $true
    Invoke-BoundedProcess $uninstaller @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=$(Join-Path $evidence 'uninstall.log')") 'uninstall' (Get-OperationBudget $lifecycleDeadline 60)
    $removalDeadline = [DateTime]::UtcNow.AddSeconds((Get-OperationBudget $lifecycleDeadline 20))
    do {
        $remaining = Get-RemainingInstallation
        if (-not ($remaining.fileCount -or $remaining.registryCount -or $remaining.shortcutCount -or $remaining.processCount)) { break }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $removalDeadline)
    Assert-RemovedState $remaining
    $summary.uninstallVerified = $true
    $summary.status = 'passed'
} catch {
    $summary.status = 'failed'; $summary.failure = $_.ToString()
    $_.ToString() | Set-Content -LiteralPath (Join-Path $evidence 'failure.txt')
} finally {
    if ($app) {
        Invoke-CleanupAction $summary 'App exit evidence' {
            $app.Refresh()
            $exitCode = if ($app.HasExited) { $app.ExitCode } else { $null }
            Write-Json @{ pid = $app.Id; hasExited = $app.HasExited; exitCode = $exitCode } 'app-exit.json'
        }
    }
    if ($mutationStarted) {
        # No force-kill, supported retry-uninstall or fallback deletion on success.
        if ($summary.status -ne 'passed') {
            Invoke-CleanupAction $summary 'Failure diagnostics' { $null = Get-RemainingInstallation }
            Invoke-CleanupAction $summary 'Stop owned processes' { Stop-OwnedProcesses }
            Invoke-CleanupAction $summary 'Cleanup uninstall' {
                $uninstaller = Join-Path $installRoot 'unins000.exe'
                if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
                    Invoke-BoundedProcess $uninstaller @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=$(Join-Path $evidence 'cleanup-uninstall.log')") 'cleanup-uninstall' 30
                }
            }
            Invoke-CleanupAction $summary 'Stop after uninstall' { Stop-OwnedProcesses }
            Invoke-CleanupAction $summary 'Owned links' {
                foreach ($link in @(Get-TaskLinks)) {
                    if (-not $link.target.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing unrelated shortcut removal' }
                    Remove-Item -LiteralPath $link.path -Force -ErrorAction Stop
                }
            }
            Invoke-CleanupAction $summary 'Owned registry' {
                foreach ($entry in @(Get-Registrations)) {
                    if ($entry.hive -ne 'CurrentUser' -or $entry.InstallLocation.TrimEnd('\') -ine $installRoot) { throw 'Refusing unrelated registry removal' }
                    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Enum]::Parse([Microsoft.Win32.RegistryView], $entry.view))
                    try { $base.DeleteSubKeyTree($uninstallKey, $false) } finally { $base.Dispose() }
                }
            }
            Invoke-CleanupAction $summary 'Owned directory' { Remove-OwnedDirectory $installRoot $runnerTemp }
        }
        # Never recursively delete a profile or read session contents, even on CI.
        # Only a newly-created, empty directory is safe to remove.
        Invoke-CleanupAction $summary 'Signed-out profile' {
            Remove-EmptyProfile $profile $localData
        }
        Invoke-CleanupAction $summary 'Final independent removal' { Assert-RemovedState (Get-RemainingInstallation) }
    }
    $summary.finishedUtc = [DateTime]::UtcNow.ToString('o')
    if ($transcriptStarted) { Invoke-CleanupAction $summary 'Transcript' { Stop-Transcript | Out-Null } }
    Write-Json $summary 'summary.json'
    if ($app) { $app.Dispose() }
}
$summary | ConvertTo-Json -Depth 6 | Write-Output
if ($summary.status -ne 'passed') { exit 1 }
exit 0
