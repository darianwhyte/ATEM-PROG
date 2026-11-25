@echo off
setlocal
if not exist "%~dp0ATEM-PROG.exe" (
    if exist "%~dp0launcher\win\build.bat" call "%~dp0launcher\win\build.bat"
)
set "TARGET=%~dp0ATEM-PROG.exe"
if not exist "%TARGET%" set "TARGET=%~dp0Launch-ATEM-PROG.bat"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\ATEM-PROG.lnk'); $lnk.TargetPath = '%TARGET%'; $lnk.WorkingDirectory = '%~dp0'; $lnk.IconLocation = '%~dp0assets\atem-prog.ico,0'; $lnk.Description = 'ATEM-PROG Broadcast Switcher Studio'; $lnk.Save()"
echo Desktop shortcut "ATEM-PROG" created pointing to %TARGET%!
echo You can right-click ATEM-PROG.exe (or the Desktop shortcut) and choose "Pin to taskbar".
timeout /t 4 >nul
exit /b 0
