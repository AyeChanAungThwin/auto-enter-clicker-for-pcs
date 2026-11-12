@echo off
rem Registers the enterclickerbridge:// one-click launcher (HKCU, this user
rem only): after this, the web app's "Start bridge" button — and its
rem automatic attempt when the page loads — can launch start-bridge.bat (the
rem same visible console window as double-clicking it) whenever the bridge is
rem not running. Note: simply running bridge.py once registers this too —
rem this script is only needed to register without running the bridge. Run
rem disable-bridge-launch-windows.bat to undo.
setlocal
cd /d "%~dp0"
reg add HKCU\Software\Classes\enterclickerbridge /ve /t REG_SZ /d "URL:Enter Key Clicker Bridge" /f
reg add HKCU\Software\Classes\enterclickerbridge /v "URL Protocol" /t REG_SZ /d "" /f
rem cmd /c strips the first and last quote of the command line, so the URL
rem argument browsers append would end up unterminated — the doubled quotes
rem below compensate for that.
reg add HKCU\Software\Classes\enterclickerbridge\shell\open\command /ve /t REG_SZ /d "cmd.exe /c \"\"%~dp0start-bridge.bat\" \"%%1\"\"" /f
echo Done — the web app's "Start bridge" button can now launch the bridge.
pause
