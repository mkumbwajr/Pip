; Pip's installer. Built with plain NSIS so it can be compiled on Linux, macOS or Windows:
;   makensis build/pip.nsi      (after electron-builder has produced dist/win-unpacked)
; Installs for the current user only, no admin rights. The uninstaller removes Pip's hooks from the agents' configs.
Unicode true
SetCompressor /SOLID lzma
!define VERSION "0.5.0"
!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\Pip"

Name "Pip"
Caption "Pip ${VERSION} Setup"
OutFile "..\dist\Pip-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Pip"
RequestExecutionLevel user
ShowInstDetails nevershow
ShowUninstDetails nevershow
BrandingText "BANG DIGITAL LTD"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Pip"
VIAddVersionKey "CompanyName" "BANG DIGITAL LTD"
VIAddVersionKey "FileDescription" "Pip Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "BANG DIGITAL LTD"

; ---------- the look: Modern UI with a welcome page (Pip's picture on the left), progress, and a finish page ----------
!include "MUI2.nsh"
!define MUI_ICON "pip.ico"                                   ; Pip's head, drawn by tools/make-icon.js
!define MUI_UNICON "pip.ico"
!include "nsDialogs.nsh"
!define MUI_WELCOMEFINISHPAGE_BITMAP "installer-side.bmp"      ; drawn by tools/make-installer-art.js
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "installer-side.bmp"
!define MUI_WELCOMEPAGE_TITLE "Welcome to Pip Setup"
!define MUI_WELCOMEPAGE_TEXT "This will install Pip ${VERSION} on your computer.$\r$\n$\r$\nClick Next to continue, or Cancel to exit Setup."
!define MUI_PAGE_CUSTOMFUNCTION_SHOW WelcomeShow
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "Pip is installed"
!define MUI_FINISHPAGE_TEXT "Pip sits at the top of your screen. Hover over it to open it.$\r$\n$\r$\nClick Finish to close Setup."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Pip.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start Pip now"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; the copyright line at the bottom of the welcome page
Var Copyright
Function WelcomeShow
  ${NSD_CreateLabel} 120u 178u 195u 10u "Copyright ${U+00A9} 2026 BANG DIGITAL LTD"
  Pop $Copyright
  SetCtlColors $Copyright "000000" "FFFFFF"
FunctionEnd

Section "Pip"
  nsExec::Exec 'taskkill /F /IM Pip.exe'
  ; Pip was called Peep before 0.5. Take its place: close it and remove its program, shortcuts and uninstall entry.
  ; Its settings folder (%APPDATA%\Peep) and its hook entries stay: Pip copies the settings and replaces the hooks
  ; with its own on first start, so connected agents never go quiet.
  nsExec::Exec 'taskkill /F /IM Peep.exe'
  Sleep 500
  RMDir /r "$LOCALAPPDATA\Programs\Peep"
  Delete "$SMPROGRAMS\Peep.lnk"
  Delete "$DESKTOP\Peep.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Peep"
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\tz.co.bang.peep"
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\dev.peep.app"
  SetOutPath "$INSTDIR"
  File /r "..\dist\win-unpacked\*.*"
  WriteUninstaller "$INSTDIR\Uninstall Pip.exe"
  CreateShortcut "$SMPROGRAMS\Pip.lnk" "$INSTDIR\Pip.exe"
  CreateShortcut "$DESKTOP\Pip.lnk" "$INSTDIR\Pip.exe"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "Pip"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "BANG DIGITAL LTD"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\Pip.exe"
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\Uninstall Pip.exe"'
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM Pip.exe'
  Sleep 500
  ExecWait '"$INSTDIR\Pip.exe" --remove-hooks'
  Delete "$SMPROGRAMS\Pip.lnk"
  Delete "$DESKTOP\Pip.lnk"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Pip"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Pip"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST}"
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\tz.co.bang.pip" ; the name and icon Windows shows on notifications
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\tz.co.bang.peep" ; the same, from when the app was called Peep
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\dev.peep.app"
SectionEnd
