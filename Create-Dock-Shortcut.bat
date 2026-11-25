@echo off
setlocal
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\ATEM-PROG.lnk'); $lnk.TargetPath = '%~dp0Launch-ATEM-PROG.bat'; $lnk.WorkingDirectory = '%~dp0'; $lnk.IconLocation = '%~dp0assets\atem-prog.ico,0'; $lnk.WindowStyle = 7; $lnk.Description = 'ATEM-PROG Broadcast Switcher Studio'; $lnk.Save()"
echo Desktop shortcut "ATEM-PROG" created with custom icon!
echo You can now right-click it on your Desktop and choose "Pin to taskbar" for a dock icon.
timeout /t 4 >nul
exit /b 0
