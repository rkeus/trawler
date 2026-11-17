; The stock check asks PowerShell for Win32_Process through WMI, which can take minutes on some
; machines and freezes the installer and uninstaller at the start. tasklist/taskkill answer at once.
; Defining customCheckAppRunning also drops the stock includes below, so they are repeated here.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  Var /GLOBAL IsPowerShellAvailable
  StrCpy $IsPowerShellAvailable 1 ; 1 = not used, so FIND_PROCESS and KILL_PROCESS fall back to tasklist/taskkill
  !insertmacro _CHECK_APP_RUNNING
!macroend
