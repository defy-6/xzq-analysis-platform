@echo off
rem ============================================================
rem  One-click Git pull (GitHub -> local)
rem  Real logic lives in git-pull.ps1 (same folder).
rem ============================================================
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0git-pull.ps1"
echo.
pause
