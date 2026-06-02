@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js / npm was not found.
  echo Install Node.js from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

echo Starting ESP32 video player...
echo The browser will open the same localhost port shown as [dev] website.
set OPEN_BROWSER=1
call npm run dev

pause
