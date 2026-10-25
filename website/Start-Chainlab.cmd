@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 22.12+ and try again.
  pause
  exit /b 1
)
node scripts\preview.mjs %*
if errorlevel 1 (
  echo Preview did not start. See the error above.
  pause
  exit /b 1
)
