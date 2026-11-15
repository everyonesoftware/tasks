#ifndef BuildNumber
  #error BuildNumber is required
#endif
#ifndef PublishDir
  #error PublishDir is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif

[Setup]
AppId={{d65cbd98-53e5-47a0-8c65-fcc03f2df1ac}
AppName=Tasks
AppVersion={#BuildNumber}
AppPublisher=Everyone Software
AppPublisherURL=https://github.com/everyonesoftware/tasks
DefaultDirName={localappdata}\Programs\Tasks
DefaultGroupName=Tasks
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
Uninstallable=yes
UninstallDisplayName=Tasks
UninstallDisplayIcon={app}\Tasks.exe
OutputDir={#OutputDir}
OutputBaseFilename=Tasks-Windows-{#BuildNumber}-Setup
VersionInfoVersion=0.1.{#BuildNumber}.0
VersionInfoDescription=Tasks Windows installer (unsigned)
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
SetupLogging=yes
SignedUninstaller=no

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\Tasks"; Filename: "{app}\Tasks.exe"; WorkingDir: "{app}"

[Run]
Filename: "{app}\Tasks.exe"; Description: "Launch Tasks"; Flags: nowait postinstall skipifsilent unchecked
