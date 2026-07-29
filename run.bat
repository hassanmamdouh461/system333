@echo off
echo =========================================
echo Starting BrewMaster POS (system333)
echo =========================================

REM Prefer the portable Node.js next to the repo, if present
set "PORTABLE_NODE=%~dp0..\node-v20.11.1-win-x64"
if exist "%PORTABLE_NODE%\node.exe" (
    echo Using portable Node.js v20.11.1
    set "PATH=%PORTABLE_NODE%;%PATH%"
) else (
    REM Fall back to a system-installed Node.js
    where node >nul 2>nul
    if errorlevel 1 (
        echo.
        echo [ERROR] Node.js was not found.
        echo Install Node.js 20+ from https://nodejs.org
        echo or place the portable node-v20.11.1-win-x64 folder next to this repo.
        echo.
        pause
        exit /b 1
    )
    echo Using system Node.js
)

npm run electron:dev
pause
