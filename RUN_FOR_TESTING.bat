@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1 || (echo Install Node.js first.& pause & exit /b 1)
if not exist node_modules call npm install --no-audit --no-fund
call npm start
