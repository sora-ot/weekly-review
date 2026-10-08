@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.13 or later.
  pause
  exit /b 1
)
set "WEEKLY_OPEN_BROWSER=1"
node server.mjs
pause
