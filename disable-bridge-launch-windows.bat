@echo off
rem Removes the enterclickerbridge:// protocol handler registered by
rem enable-bridge-launch-windows.bat.
setlocal
reg delete HKCU\Software\Classes\enterclickerbridge /f 2>nul
echo The one-click "Start bridge" launcher has been removed.
pause
