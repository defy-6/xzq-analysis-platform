@echo off
rem ============================================================
rem  Xiamen-Zhangzhou-Quanzhou Metropolitan Analysis Platform
rem  Windows double-click launcher.
rem
rem  Requirements:
rem    - Node.js >= 22.13 (https://nodejs.org/)
rem    - Windows 10 1803+ (built-in curl.exe)
rem
rem  The real logic lives in start-platform.ps1 (same folder).
rem ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-platform.ps1"
echo.
pause
