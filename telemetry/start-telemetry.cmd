@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PTGamingSK Transport - Telemetry v1.2
where py >nul 2>nul
if errorlevel 1 (
  echo Python 3 sa nenasiel. Nainstaluj Python z python.org.
  pause
  exit /b 1
)
py -3 "%~dp0ets2_bridge.py"
pause
