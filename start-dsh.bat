@echo off
setlocal enabledelayedexpansion
title DeepSeek Harness Launcher

rem ============================================================
rem  DeepSeek Harness (dsh) Web UI launcher
rem
rem  Default flow (no args):
rem    - checks for updates automatically (via 7897 proxy, falls
rem      back to direct), starts without asking when up to date
rem    - asks once when new commits exist: update + redeploy now?
rem    - on a pull conflict the update ROLLS BACK to the version
rem      before the pull; local changes are preserved in git stash
rem    - then kills the old process on WEB_PORT and starts the UI
rem
rem  Usage:
rem    start-dsh.bat            auto-check update, ask if any, start
rem    start-dsh.bat -s         skip update check, start directly
rem    start-dsh.bat -u         force update (no prompt), then start
rem
rem  Configurable below: WEB_PORT / PROXY_URL / OPEN_BROWSER
rem ============================================================

set "PROJECT_DIR=%~dp0"
set "WEB_PORT=3080"
set "PROXY_URL=http://127.0.0.1:7897"
set "OPEN_BROWSER=0"

cd /d "%PROJECT_DIR%"

where pnpm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pnpm not found. Install it first: npm install -g pnpm@11.7.0
    pause
    exit /b 1
)

set "MODE=auto"
if /i "%~1"=="-s" set "MODE=skip"
if /i "%~1"=="--start" set "MODE=skip"
if /i "%~1"=="-u" set "MODE=force"
if /i "%~1"=="--update" set "MODE=force"

if "%MODE%"=="skip" goto :do_start

rem ---------- auto mode: check, ask only when updates exist ----------
if "%MODE%"=="auto" (
    call :check_update
    if errorlevel 1 (
        echo [INFO] Update not applied, continuing with the current version
    )
    goto :do_start
)

rem ---------- force mode: update without asking ----------
call :update
if errorlevel 1 (
    echo [WARN] Update failed or was rolled back; starting anyway
)
goto :do_start

rem ---------- kill old process then start ----------
:do_start
call :kill_old
call :launch
exit /b 0

rem ============================================================
rem  Sub: check for updates via proxy, ask once when new commits exist
rem ============================================================
:check_update
call :setup_proxy
echo [UPDATE] Fetching remote repo ...
git -c http.proxy=%PROXY_URL% -c https.proxy=%PROXY_URL% fetch origin 2>&1
if errorlevel 1 (
    git fetch origin 2>&1
    if errorlevel 1 (
        echo   [INFO] Cannot reach GitHub, skipping update
        exit /b 1
    )
)

rem shallow clone: fetch full history once (optional, non-fatal)
for /f "delims=" %%v in ('git rev-parse --is-shallow-repository 2^>nul') do set "IS_SHALLOW=%%v"
if /i "!IS_SHALLOW!"=="true" (
    echo [UPDATE] Shallow clone detected, fetching full history ...
    git -c http.proxy=%PROXY_URL% -c https.proxy=%PROXY_URL% fetch --unshallow origin >nul 2>&1
)

set "BEHIND=0"
for /f "delims=" %%n in ('git rev-list --count HEAD..origin/master 2^>nul') do set "BEHIND=%%n"
if "!BEHIND!"=="0" (
    echo [UPDATE] Already up to date
    exit /b 0
)

echo.
echo [UPDATE] %BEHIND% new commit(s) available on GitHub.
set /p "ANS=Update and redeploy now? [Y/N] "
if /i "!ANS!"=="Y" (
    call :update
    exit /b !errorlevel!
)
echo [INFO] Update skipped
exit /b 1

rem ============================================================
rem  Sub: update + redeploy, rolling back on pull conflict
rem ============================================================
:update
call :setup_proxy
echo [UPDATE] Fetching remote repo ...
git -c http.proxy=%PROXY_URL% -c https.proxy=%PROXY_URL% fetch origin 2>&1
if errorlevel 1 (
    git fetch origin 2>&1
    if errorlevel 1 (
        echo   [ERROR] Cannot reach GitHub
        exit /b 1
    )
)

rem remember where we were, for rollback
set "ORIG_HEAD="
for /f "delims=" %%h in ('git rev-parse HEAD 2^>nul') do set "ORIG_HEAD=%%h"

echo [UPDATE] Pulling ...
git pull --ff-only origin master 2>&1
if errorlevel 1 (
    echo [UPDATE] Pull conflict detected, rolling back ...
    rem save every tracked local change into stash; untracked files are
    rem left in place (pull never touches them) and the script survives
    git stash push -m "dsh auto-update rollback" >nul 2>&1
    if defined ORIG_HEAD git reset --hard %ORIG_HEAD% >nul 2>&1
    echo   [INFO] Rolled back to the previous version. Your local changes are
    echo          preserved in git stash:
    echo        git stash list
    echo        git stash pop   -- resolve conflicts with another model
    exit /b 1
)

echo [UPDATE] Installing dependencies (pnpm install) ...
call pnpm install 2>&1
if errorlevel 1 (
    echo   [INFO] Install failed, retrying without proxy ...
    set "HTTP_PROXY="
    set "HTTPS_PROXY="
    set "npm_config_proxy="
    set "npm_config_https_proxy="
    call pnpm install 2>&1
    if errorlevel 1 exit /b 1
)

echo [UPDATE] Rebuilding (pnpm run build) ...
call pnpm run build 2>&1
if errorlevel 1 exit /b 1

echo [DONE] Update finished. Current version:
git log -1 --oneline
exit /b 0

rem ============================================================
rem  Sub: probe the proxy and export it for git/pnpm fallbacks
rem ============================================================
:setup_proxy
echo [UPDATE] Testing proxy %PROXY_URL% ...
curl -sI -m 6 -x "%PROXY_URL%" https://github.com >nul 2>&1
if errorlevel 1 (
    echo   [INFO] Proxy unavailable, will use direct connection
) else (
    echo   [INFO] Proxy available, update will go through proxy
    set "HTTP_PROXY=%PROXY_URL%"
    set "HTTPS_PROXY=%PROXY_URL%"
    set "npm_config_proxy=%PROXY_URL%"
    set "npm_config_https_proxy=%PROXY_URL%"
)
exit /b 0

rem ============================================================
rem  Sub: kill leftover dsh node instances and anything on WEB_PORT
rem ============================================================
:kill_old
echo.
echo [1/2] Checking port %WEB_PORT% ...
rem 1) kill leftover dsh node instances (matches apps/cli/src/bin.ts)
for /f "tokens=2 delims==" %%p in ('wmic process where "name='node.exe' and commandline like '%%bin.ts%%'" get ProcessId /value 2^>nul ^| findstr "^ProcessId="') do (
    echo       Killing leftover dsh process PID=%%p ...
    taskkill /F /PID %%p >nul 2>&1
)
rem 2) kill anything listening on WEB_PORT
set "FOUND=0"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%WEB_PORT% "') do (
    echo       Killing old process PID=%%p ...
    taskkill /F /PID %%p >nul 2>&1
    set "FOUND=1"
)
if "!FOUND!"=="1" (
    call :delay 2
    for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%WEB_PORT% "') do (
        echo       [WARN] Port still busy, killing PID=%%p again
        taskkill /F /PID %%p >nul 2>&1
    )
    call :delay 1
)
echo       Port check done
exit /b 0

rem ============================================================
rem  Sub: launch Web UI
rem ============================================================
:launch
echo.
echo [2/2] Starting DeepSeek Harness Web UI ...
echo       URL: http://127.0.0.1:%WEB_PORT%
echo       NOTE: cold start takes ~30-60s before the page responds,
echo             do not panic if the port is not up yet
echo       Vision bridge: configure in Web UI Settings > Plugins (or env vars)
echo.
if "%OPEN_BROWSER%"=="1" (
    rem wait ~10s for the service, then open browser
    start "" /b cmd /c "ping -n 11 -w 1000 127.0.0.1 >nul & start "" http://127.0.0.1:%WEB_PORT%"
)
call pnpm dsh web
rem A dsh startup race can exit the launcher process while the webserver
rem survives as an orphan; treat a live port as a running service.
netstat -ano | findstr "LISTENING" | findstr ":%WEB_PORT% " >nul 2>&1
if not errorlevel 1 (
    echo [INFO] Service is running at http://127.0.0.1:%WEB_PORT%
    exit /b 0
)
echo [INFO] Service stopped
exit /b 0

rem ============================================================
rem  Sub: delay N seconds (ping-based, stdin-redirect safe)
rem ============================================================
:delay
ping -n %~1 -w 1000 127.0.0.1 >nul 2>&1
exit /b 0
