@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "ALARM_ELECTRON=%~dp0workbench\node_modules\electron\dist\electron.exe"
if not exist "%ALARM_ELECTRON%" (
  echo Cannot find the installed Workbench Electron runtime.
  pause
  exit /b 1
)
start "" "%ALARM_ELECTRON%" "%~dp0workbench\upload-alarm" %*
exit /b 0
