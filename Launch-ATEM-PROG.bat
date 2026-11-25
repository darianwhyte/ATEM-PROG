@echo off
setlocal
cd /d "%~dp0"

:: Launch native Windows taskbar & system tray app if present (or build it on demand)
if not exist "%~dp0ATEM-PROG.exe" (
    if exist "%~dp0launcher\win\build.bat" (
        call "%~dp0launcher\win\build.bat" >nul 2>&1
    )
)

if exist "%~dp0ATEM-PROG.exe" (
    start "" "%~dp0ATEM-PROG.exe" %*
    exit /b 0
)

:: Fallback if .exe could not be found or built
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

powershell -NoProfile -WindowStyle Hidden -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:8993/api/status | Out-Null } catch { Start-Process -WindowStyle Hidden -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory '%~dp0bridge'; for ($i=0; $i -lt 20; $i++) { Start-Sleep -Milliseconds 150; try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:8993/api/status | Out-Null; break } catch {} } }"
start "" "http://127.0.0.1:8993/launcher.html"
exit /b 0
