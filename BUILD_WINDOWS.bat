@echo off
setlocal
cd /d "%~dp0"
title Build - E-Class Record App with GS and SF9

echo ============================================================
echo   E-Class Record App with GS and SF9 - Windows Builder
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found.
  echo Install the current Node.js LTS release, then run this file again.
  echo.
  pause
  exit /b 1
)

echo [1/2] Installing build dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo Dependency installation failed. Check your internet connection and try again.
  pause
  exit /b 1
)

echo.
echo [2/2] Building the Windows installer...
call npm run dist
if errorlevel 1 (
  echo.
  echo Installer build failed. Review the messages above.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo Build complete. Opening the dist folder...
echo ============================================================
start "" "%~dp0dist"
pause
