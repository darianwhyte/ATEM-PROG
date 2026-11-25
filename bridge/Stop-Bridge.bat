@echo off
echo Stopping ATEM-PROG Hardware Bridge on port 8993...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8993" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>nul
)
echo Done.
timeout /t 2 >nul
