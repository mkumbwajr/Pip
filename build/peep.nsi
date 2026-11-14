; Peep's installer. Built with plain NSIS so it can be compiled on Linux, macOS or Windows:
;   makensis build/peep.nsi      (after electron-builder has produced dist/win-unpacked)
; Installs for the current user only, no admin rights. The uninstaller removes Peep's hooks from the agents' configs.
Unicode true
SetCompressor /SOLID lzma
!define VERSION "0.4.0"
!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\Peep"

Name "Peep"
Caption "Peep ${VERSION} Setup"
OutFile "..\dist\Peep-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Peep"
RequestExecutionLevel user
ShowInstDetails nevershow
ShowUninstDetails nevershow
BrandingText "BANG DIGITAL LTD"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Peep"
VIAddVersionKey "CompanyName" "BANG DIGITAL LTD"
VIAddVersionKey "FileDescription" "Peep Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "BANG DIGITAL LTD"

; ---------- the look: Modern UI with a welcome page (Peep's picture on the left), progress, and a finish page ----------
!include "MUI2.nsh"
!define MUI_ICON "peep.ico"                                   ; Pip's head, drawn by tools/make-icon.js
!define MUI_UNICON "peep.ico"
!include "nsDialogs.nsh"
!define MUI_WELCOMEFINISHPAGE_BITMAP "installer-side.bmp"      ; drawn by tools/make-installer-art.js
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "installer-side.bmp"
!define MUI_WELCOMEPAGE_TITLE "Welcome to Peep Setup"
!define MUI_WELCOMEPAGE_TEXT "This will install Peep ${VERSION} on your computer.$\r$\n$\r$\nClick Next to continue, or Cancel to exit Setup."
!define MUI_PAGE_CUSTOMFUNCTION_SHOW WelcomeShow
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "Peep is installed"
!define MUI_FINISHPAGE_TEXT "Peep sits at the top of your screen. Hover over it to open it.$\r$\n$\r$\nClick Finish to close Setup."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Peep.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start Peep now"
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
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\dev.peep.app" ; the name and icon Windows shows on notifications
SectionEnd
