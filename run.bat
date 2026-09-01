@echo off
REM Engaz POS (system333) - console launcher.
REM
REM Kept as the visible/debuggable entry point. The desktop shortcut uses
REM launcher\launch.vbs instead, which hides this window on the normal path.
REM
REM Optional argument: Electron | Browser | Auto  (default Auto)

setlocal
set "MODE=%~1"
if "%MODE%"=="" set "MODE=Auto"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\launch.ps1" -Mode %MODE%
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
    echo.
    echo Startup failed with exit code %RC%. See logs\launcher.log
    pause
)

endlocal & exit /b %RC%
