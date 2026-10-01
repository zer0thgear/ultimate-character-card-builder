@echo off
rem Updates UCCB from GitHub (git pull), installs anything new it needs, then
rem starts it and opens it in the browser, as run.bat does. Close this window
rem to stop it. Your cards and settings (data\) and local\ are never touched.
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo Git isn't installed, so UCCB can't update itself. Starting the copy you have.
  goto run
)
if not exist .git (
  echo This copy wasn't cloned with git ^(a zip download?^), so it can't update itself. Starting the copy you have.
  goto run
)

for /f %%h in ('git rev-parse HEAD') do set BEFORE=%%h
echo Updating UCCB...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo Couldn't update: you may have changed files here, or be offline. Nothing of yours was changed.
  echo Starting the copy you have.
  goto run
)
rem New or updated dependencies come with a changed package.json or lock file.
git diff --quiet %BEFORE% HEAD -- package.json package-lock.json
if errorlevel 1 call npm install

:run
if not exist node_modules call npm install
start "" /b cmd /c "timeout /t 6 >nul & start http://localhost:3210"
call npm run dev
pause
