@echo off
setlocal
set "ROOT=%~dp0..\.."
set "CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%SystemRoot%\Microsoft.NET\Framework\v4.0.30319\csc.exe"

if not exist "%CSC%" (
    echo ERROR: Could not locate .NET Framework 4 csc.exe compiler.
    exit /b 1
)

echo Building ATEM-PROG.exe with built-in .NET compiler...
"%CSC%" /nologo /target:winexe /optimize+ /platform:anycpu ^
    /out:"%ROOT%\ATEM-PROG.exe" ^
    /win32icon:"%ROOT%\assets\atem-prog.ico" ^
    /resource:"%ROOT%\assets\atem-prog-icon-192.png",atem-prog-icon-192.png ^
    /r:System.dll ^
    /r:System.Drawing.dll ^
    /r:System.Windows.Forms.dll ^
    /r:System.Web.Extensions.dll ^
    "%~dp0AtemProgLauncher.cs"

if errorlevel 1 (
    echo Build FAILED.
    exit /b 1
)

echo Built "%ROOT%\ATEM-PROG.exe" successfully!
exit /b 0
