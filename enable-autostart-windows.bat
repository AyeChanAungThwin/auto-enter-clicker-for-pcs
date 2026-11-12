@echo off
rem Registers an auto-start entry for the bridge: runs silently (pythonw, no
rem console window) every time this user logs in. Run enable once; use
rem disable-autostart-windows.bat to undo.
setlocal
cd /d "%~dp0"
for /f "usebackq delims=" %%P in (`python -c "import sys, os; print(os.path.join(os.path.dirname(sys.executable), 'pythonw.exe'))"`) do set PYW=%%P
if not exist "%PYW%" (
  echo Could not locate pythonw.exe — check that Python is installed.
  pause
  exit /b 1
)
reg add HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v "EnterKeyClickerBridge" /t REG_SZ /d "\"%PYW%\" \"%~dp0bridge.py\"" /f
echo Bridge will now start silently at every login.
pause
