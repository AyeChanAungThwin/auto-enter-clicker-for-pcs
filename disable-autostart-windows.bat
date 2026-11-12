@echo off
rem Removes the bridge auto-start entry created by enable-autostart-windows.bat.
reg delete HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v "EnterKeyClickerBridge" /f
echo Bridge auto-start removed.
pause
