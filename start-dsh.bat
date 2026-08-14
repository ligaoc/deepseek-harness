@echo off
setlocal enabledelayedexpansion
title DeepSeek Harness Launcher

rem ============================================================
rem  DeepSeek Harness (dsh) Web UI launcher
rem
rem  Topology (since the fork split):
rem    origin   -> your fork (ligaoc/deepseek-harness)
rem    upstream -> upstream project (deepseek-ai/deepseek-harness)
rem    master   -> clean, tracks upstream (use GitHub "Sync fork")
rem    custom   -> your customizations (daily work lives here)
rem
rem  The in-app auto-update plugin owns scheduled syncs (startup
rem  check + daily scan with install/build/test gates, conflict
rem  snapshots in update\conflict-*.diff). This launcher only:
rem    - default: starts without asking (plugin handles updates)
rem    - -u: force a manual update now (merge upstream/master into
rem          the current branch with rollback), then start
rem
rem  Usage:
rem    start-dsh.bat            start directly (plugin checks updates)
rem    start-dsh.bat -s         same as default (kept for compatibility)
rem    start-dsh.bat -u         force manual update, then start
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

rem ---------- force mode: manual update (merge upstream into current branch) ----------
if "%MODE%"=="force" (
    call :update
    if errorlevel 1 (
        echo [WARN] Update failed or was rolled back; starting anyway
    )
)

rem ---------- kill old process then start ----------
:do_start
call :kill_old
call :launch
exit /b 0

rem ============================================================
rem  Sub: manual update + redeploy, rolling back on merge conflict
rem ============================================================
:update
call :setup_proxy
echo [UPDATE] Fetching upstream ...
git -c http.proxy=%PROXY_URL% -c https.proxy=%PROXY_URL% fetch upstream 2>&1
if errorlevel 1 (
    git fetch upstream 2>&1
    if errorlevel 1 (
        echo   [ERROR] Cannot reach GitHub
        exit /b 1
    )
)

rem require a clean tree: merge refuses to run otherwise
set "DIRTY="
for /f "delims=" %%s in ('git status --porcelain') do set "DIRTY=1"
if defined DIRTY (
    echo   [ERROR] Working tree is dirty. Commit or stash first, then retry.
    exit /b 1
)

rem remember where we were, for rollback
set "ORIG_HEAD="
for /f "delims=" %%h in ('git rev-parse HEAD 2^>nul') do set "ORIG_HEAD=%%h"

echo [UPDATE] Merging upstream/master ...
git merge upstream/master 2>&1
if errorlevel 1 (
    echo [UPDATE] Merge conflict detected, snapshotting and rolling back ...
    for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%t"
    if not exist update mkdir update
    git diff > "update\conflict-%STAMP%.diff" 2>nul
    git merge --abort >nul 2>&1
    echo   [INFO] Rolled back to %ORIG_HEAD%.
    echo   [INFO] Conflict snapshot: update\conflict-%STAMP%.diff
    echo   [INFO] Hand it to a model together with update\CONFLICT_PROMPT.md
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
    if errorlevel 1 (
        echo   [INFO] Gate failed, rolling back to %ORIG_HEAD% ...
        git reset --hard %ORIG_HEAD% >nul 2>&1
        exit /b 1
    )
)

echo [UPDATE] Rebuilding (pnpm run build) ...
call pnpm run build 2>&1
if errorlevel 1 (
    echo   [INFO] Gate failed, rolling back to %ORIG_HEAD% ...
    git reset --hard %ORIG_HEAD% >nul 2>&1
    exit /b 1
)

echo [UPDATE] Pushing to your fork ...
git push origin custom 2>&1
if errorlevel 1 (
    echo   [WARN] Push failed; the local merge is kept, push later with:
    echo        git push origin custom
)

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
echo       Auto update: configure in Web UI Settings > Plugins (or update\README.md)
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
