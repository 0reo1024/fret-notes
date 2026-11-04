@echo off
setlocal
cd /d "%~dp0"
if exist "release\Fret Notes.exe" (
  start "" "release\Fret Notes.exe"
  exit /b 0
)
where node >nul 2>nul
if errorlevel 1 (
  echo Build the desktop app first, or install Node.js 22.12 or newer for development.
  pause
  exit /b 1
)
call npm.cmd run desktop:dev
if errorlevel 1 pause
