; PATH checkbox is default-off so we do not shadow an existing npm-global dsh.
!include "WinMessages.nsh"
!include "LogicLib.nsh"
!include "nsDialogs.nsh"

; Do not use electron-builder's INSTALL_REGISTRY_KEY: the uninstaller
; compile does not define it, and makensis treats that warning as error.
!define DSH_USER_PATH_REG "Software\ai.deepseek.harness.desktop"

!ifndef BUILD_UNINSTALLER
  Var DshAddToPath
  Var DshAddToPathCheckbox

  Function dshPathPageShow
    IfSilent 0 +2
      Abort
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 36u \
      "Adds resources\harness\bin so dsh works in new terminals. Leave unchecked if you already have dsh from npm."
    Pop $0
    ${NSD_CreateCheckbox} 0 50u 100% 12u "Add dsh to the user PATH"
    Pop $DshAddToPathCheckbox
    ${NSD_SetState} $DshAddToPathCheckbox ${BST_UNCHECKED}
    nsDialogs::Show
  FunctionEnd

  Function dshPathPageLeave
    ${NSD_GetState} $DshAddToPathCheckbox $DshAddToPath
  FunctionEnd

  Function AddDshToUserPath
    Push $0
    Push $1
    StrCpy $1 "$INSTDIR\resources\harness\bin"
    ReadRegStr $0 HKCU "${DSH_USER_PATH_REG}" DshUserPath
    ${If} $0 == ""
      ReadRegStr $0 HKCU "Environment" "Path"
      ${If} $0 == ""
        WriteRegExpandStr HKCU "Environment" "Path" "$1"
      ${Else}
        WriteRegExpandStr HKCU "Environment" "Path" "$0;$1"
      ${EndIf}
      WriteRegStr HKCU "${DSH_USER_PATH_REG}" DshUserPath "$1"
      SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
    ${EndIf}
    Pop $1
    Pop $0
  FunctionEnd
!else
  Function un.RemoveDshFromUserPath
    Push $0
    Push $1
    Push $2
    Push $3
    Push $4
    Push $5
    Push $6

    ReadRegStr $1 HKCU "${DSH_USER_PATH_REG}" DshUserPath
    ${If} $1 == ""
      Goto dsh_un_done
    ${EndIf}

    ReadRegStr $0 HKCU "Environment" "Path"
    StrCpy $2 ""
    StrCpy $4 "0"
    StrCpy $3 "$0;"

    dsh_un_loop:
      StrCmp $3 "" dsh_un_finish
      StrCpy $5 0
    dsh_un_findsemi:
      StrCpy $6 $3 1 $5
      StrCmp $6 "" dsh_un_token
      StrCmp $6 ";" dsh_un_token
      IntOp $5 $5 + 1
      Goto dsh_un_findsemi
    dsh_un_token:
      StrCpy $6 $3 $5
      IntOp $5 $5 + 1
      StrCpy $3 $3 "" $5
      StrCmp $6 "" dsh_un_loop
      StrCmp $6 $1 dsh_un_loop
      StrCmp $4 "0" dsh_un_first
      StrCpy $2 "$2;$6"
      Goto dsh_un_loop
    dsh_un_first:
      StrCpy $2 "$6"
      StrCpy $4 "1"
      Goto dsh_un_loop

    dsh_un_finish:
      ${If} $2 == ""
        DeleteRegValue HKCU "Environment" "Path"
      ${Else}
        WriteRegExpandStr HKCU "Environment" "Path" "$2"
      ${EndIf}
      DeleteRegValue HKCU "${DSH_USER_PATH_REG}" DshUserPath
      SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000

    dsh_un_done:
      Pop $6
      Pop $5
      Pop $4
      Pop $3
      Pop $2
      Pop $1
      Pop $0
  FunctionEnd
!endif

!ifndef BUILD_UNINSTALLER
!macro customInit
  StrCpy $DshAddToPath "0"
!macroend

!macro customPageAfterChangeDir
  Page custom dshPathPageShow dshPathPageLeave
!macroend

!macro customInstall
  ${If} $DshAddToPath == 1
    Call AddDshToUserPath
  ${EndIf}
!macroend
!endif

!macro customUnInstall
  Call un.RemoveDshFromUserPath
!macroend
