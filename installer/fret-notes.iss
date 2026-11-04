; Fret Notes per-user installer. AppId must stay fixed so each new version replaces the installed one.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6F3C2B1E-9D4A-4E7B-8C21-5A0F3D9E7B42}
AppName=Fret Notes
AppVersion={#AppVersion}
AppVerName=Fret Notes {#AppVersion}
AppPublisher=Fret Notes
DefaultDirName={localappdata}\Programs\Fret Notes
DefaultGroupName=Fret Notes
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=..\release
OutputBaseFilename=Fret Notes Setup {#AppVersion}
SetupIconFile=..\src-tauri\icons\icon.ico
UninstallDisplayIcon={app}\Fret Notes.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"

[Files]
Source: "..\release\Fret Notes.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\release\README.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Fret Notes"; Filename: "{app}\Fret Notes.exe"
Name: "{autodesktop}\Fret Notes"; Filename: "{app}\Fret Notes.exe"

[Run]
Filename: "{app}\Fret Notes.exe"; Description: "Fret Notes を起動"; Flags: nowait postinstall skipifsilent
