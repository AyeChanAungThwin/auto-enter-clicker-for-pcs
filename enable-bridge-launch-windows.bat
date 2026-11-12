@echo off
rem Registers the enterclickerbridge:// one-click launcher (HKCU, this user
rem only): after this, the web app's "Start bridge" button — and its
rem automatic attempt when the page loads — can start bridge.py silently
rem (pythonw, no console window) whenever it is not running. Run this once;
rem use disable-bridge-launch-windows.bat to undo.
setlocal
cd /d "%~dp0"
for /f "usebackq delims=" %%P in (`python -c "import sys, os; print(os.path.join(os.path.dirname(sys.executable), 'pythonw.exe'))"`) do set PYW=%%P
if not exist "%PYW%" (
  echo Could not locate pythonw.exe — check that Python is installed.
  pause
  exit /b 1
)
reg add HKCU\Software\Classes\enterclickerbridge /ve /t REG_SZ /d "URL:Enter Key Clicker Bridge" /f
reg add HKCU\Software\Classes\enterclickerbridge /v "URL Protocol" /t REG_SZ /d "" /f
reg add HKCU\Software\Classes\enterclickerbridge\shell\open\command /ve /t REG_SZ /d "\"%PYW%\" \"%~dp0bridge.py\" \"%%1\"" /f
echo Done — the web app's "Start bridge" button can now launch the bridge.
pause
