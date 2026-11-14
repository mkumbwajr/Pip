; Peep's installer. Built with plain NSIS so it can be compiled on Linux, macOS or Windows:
;   makensis build/peep.nsi      (after electron-builder has produced dist/win-unpacked)
; Installs for the current user only, no admin rights. The uninstaller removes Peep's hooks from the agents' configs.
Unicode true
SetCompressor /SOLID lzma
!define VERSION "0.4.0"
!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\Peep"

Name "Peep"
Caption "Peep ${VERSION}"
OutFile "..\dist\Peep-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Peep"
RequestExecutionLevel user
ShowInstDetails nevershow
ShowUninstDetails nevershow
AutoCloseWindow true
BrandingText "BANG DIGITAL LTD"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Peep"
VIAddVersionKey "CompanyName" "BANG DIGITAL LTD"
VIAddVersionKey "FileDescription" "Peep Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "BANG DIGITAL LTD"
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Peep"
  nsExec::Exec 'taskkill /F /IM Peep.exe'
  Sleep 500
  SetOutPath "$INSTDIR"
  File /r "..\dist\win-unpacked\*.*"
  WriteUninstaller "$INSTDIR\Uninstall Peep.exe"
  CreateShortcut "$SMPROGRAMS\Peep.lnk" "$INSTDIR\Peep.exe"
  CreateShortcut "$DESKTOP\Peep.lnk" "$INSTDIR\Peep.exe"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "Peep"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "BANG DIGITAL LTD"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\Peep.exe"
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\Uninstall Peep.exe"'
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
SectionEnd

Function .onInstSuccess
  Exec '"$INSTDIR\Peep.exe"'
FunctionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM Peep.exe'
  Sleep 500
  ExecWait '"$INSTDIR\Peep.exe" --remove-hooks'
  Delete "$SMPROGRAMS\Peep.lnk"
  Delete "$DESKTOP\Peep.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Peep"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Peep"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST}"
SectionEnd
