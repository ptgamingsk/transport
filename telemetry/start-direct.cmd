@echo off
chcp 65001 >nul
cd /d "%~dp0"
py -3 "%~dp0ets2_direct.py" %*
pause
