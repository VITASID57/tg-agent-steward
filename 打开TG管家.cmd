@echo off
powershell.exe -NoProfile -File "%~dp0scripts\open-control.ps1"
if errorlevel 1 pause
