@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js / npm was not found.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing project dependencies...
  call npm install
)

echo Starting ESP32 video player...

:: Start Vite in a new window
start "Vite Dev Server" cmd /k "npm run dev"

:: Wait a few seconds for Vite to start
timeout /t 5 /nobreak >nul

:: Open Chrome on localhost:5173
start chrome "http://localhost:5173"

exit