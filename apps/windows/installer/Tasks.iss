#ifndef BuildNumber
  #error BuildNumber is required
#endif
#ifndef RawSetup
  #error RawSetup is required
#endif
#ifndef RawSetupSha256
  #error RawSetupSha256 is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif

; Transitional unregistered guard, NOT an Inno application installation.
; The embedded setup and all actual install/update/uninstall work belong to Velopack.
; Do not publish the unguarded embedded setup while Inno installations exist.
[Setup]
AppId={{d65cbd98-53e5-47a0-8c65-fcc03f2df1ac}
AppName=Tasks
AppVersion=0.1.{#BuildNumber}
AppPublisher=Everyone Software
DefaultDirName={localappdata}\Programs\Tasks
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
Uninstallable=no
CreateUninstallRegKey=no
; Keep Inno's directory selection so WizardDirValue honors DefaultDirName and /DIR.
; PrepareToInstall refuses unsafe targets before Inno creates any directories;
; only Velopack writes the payload, shortcuts and uninstall registration.
CreateAppDir=yes
UsePreviousAppDir=no
DisableProgramGroupPage=yes
DisableReadyPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=Tasks-Windows-{#BuildNumber}-Setup
VersionInfoVersion=0.1.{#BuildNumber}.0
VersionInfoDescription=Tasks guarded Velopack installer (unsigned)
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
SetupLogging=yes

[Files]
Source: "{#RawSetup}"; DestName: "Tasks-Velopack-Setup.exe"; Flags: dontcopy

[Code]
const
  LegacyKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{d65cbd98-53e5-47a0-8c65-fcc03f2df1ac}_is1';
  MigrationMessage = 'Uninstall Tasks once from Windows Settings > Apps, then run this installer again. Your protected sign-in session is retained by the old uninstaller. Do not delete your Tasks profile. Automatic Inno-to-Velopack migration is not supported.';
var
  Installed: Boolean;

function LegacyInstallPresent: Boolean;
begin
  Result := RegKeyExists(HKCU32, LegacyKey) or RegKeyExists(HKCU64, LegacyKey) or
    RegKeyExists(HKLM32, LegacyKey) or RegKeyExists(HKLM64, LegacyKey) or
    FileExists(ExpandConstant('{localappdata}\Programs\Tasks\unins000.exe'));
end;

function VelopackInstallPresent: Boolean;
var
  Key: String;
begin
  Key := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\TasksWindows';
  Result := RegKeyExists(HKCU32, Key) or RegKeyExists(HKCU64, Key) or
    RegKeyExists(HKLM32, Key) or RegKeyExists(HKLM64, Key) or
    FileExists(ExpandConstant('{localappdata}\Programs\Tasks\Update.exe')) or
    FileExists(ExpandConstant('{localappdata}\TasksWindows\Update.exe'));
end;

function InitializeSetup: Boolean;
begin
  Result := not LegacyInstallPresent;
  if not Result then begin
    Log(MigrationMessage);
    SuppressibleMsgBox(MigrationMessage, mbError, MB_OK, IDOK);
  end;
  if Result and VelopackInstallPresent then begin
    Result := False;
    Log('Use the installed app to update; setup will not relocate an existing Velopack installation.');
    SuppressibleMsgBox('Use the installed app to update, or uninstall Tasks manually before running setup. Your protected session is retained.', mbError, MB_OK, IDOK);
  end;
end;

function DestinationIsSafe: Boolean;
var
  Target, Profile: String;
  Entry: TFindRec;
begin
  Target := AddBackslash(ExpandFileName(WizardDirValue));
  Profile := AddBackslash(ExpandConstant('{localappdata}\EveryoneSoftware\Tasks'));
  Result := False;
  if (Pos(Lowercase(Target), Lowercase(Profile)) = 1) or
     (Pos(Lowercase(Profile), Lowercase(Target)) = 1) then exit;
  if FindFirst(Target + '*', Entry) then begin
    try
      repeat
        if (Entry.Name <> '.') and (Entry.Name <> '..') then exit;
      until not FindNext(Entry);
    finally
      FindClose(Entry);
    end;
  end;
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
  SetupPath: String;
begin
  Result := '';
  if Installed then exit;
  if LegacyInstallPresent or FileExists(AddBackslash(WizardDirValue) + 'unins000.exe') then begin
    Result := MigrationMessage;
    exit;
  end;
  if VelopackInstallPresent or FileExists(AddBackslash(WizardDirValue) + 'Update.exe') then begin
    Result := 'Use the installed app to update, or uninstall Tasks manually before running setup.';
    exit;
  end;
  if not DestinationIsSafe then begin
    Result := 'Choose an empty installation directory outside the protected Tasks session directory. Existing files will not be removed.';
    exit;
  end;
  ExtractTemporaryFile('Tasks-Velopack-Setup.exe');
  SetupPath := ExpandConstant('{tmp}\Tasks-Velopack-Setup.exe');
  if CompareText(GetSHA256OfFile(SetupPath), '{#RawSetupSha256}') <> 0 then begin
    Result := 'The embedded Velopack installer failed integrity verification.';
    exit;
  end;
  if not Exec(SetupPath, '--silent --installto ' + AddQuotes(WizardDirValue) +
      ' --log ' + AddQuotes(ExpandConstant('{log}') + '.velopack.log'), '',
      SW_HIDE, ewWaitUntilTerminated, ExitCode) then begin
    Result := 'Could not start the Velopack installer.';
    exit;
  end;
  if ExitCode <> 0 then begin
    Result := 'Velopack installation failed (exit ' + IntToStr(ExitCode) + '). No automatic legacy uninstall was attempted.';
    exit;
  end;
  Installed := True;
end;
