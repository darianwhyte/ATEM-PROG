@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    start "" "%~dp0ATEM-PROG.html"
    exit /b 0
)

if not exist "%~dp0bridge\node_modules" (
    echo First-time setup: installing ATEM-PROG service dependencies...
    pushd "%~dp0bridge"
    call npm.cmd install
    popd
)

:: Start ATEM-PROG background service completely silently (no lingering terminal window!)
powershell -NoProfile -WindowStyle Hidden -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:8993/api/status | Out-Null } catch { Start-Process -WindowStyle Hidden -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory '%~dp0bridge'; for ($i=0; $i -lt 20; $i++) { Start-Sleep -Milliseconds 150; try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:8993/api/status | Out-Null; break } catch {} } }"

:: Open Companion-style Launcher window (and exit this batch terminal immediately!)
set "LAUNCHER_URL=http://127.0.0.1:8993/launcher.html"
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=%LAUNCHER_URL% --window-size=640,740
    exit /b 0
)
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app=%LAUNCHER_URL% --window-size=640,740
    exit /b 0
)
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app=%LAUNCHER_URL% --window-size=640,740
    exit /b 0
)

start "" "%LAUNCHER_URL%"
exit /b 0
