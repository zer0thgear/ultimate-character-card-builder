@echo off
rem Starts UCCB and opens it in the browser. Close this window to stop it.
cd /d "%~dp0"
if not exist node_modules call npm install
start "" /b cmd /c "timeout /t 6 >nul & start http://localhost:3210"
call npm run dev
pause
