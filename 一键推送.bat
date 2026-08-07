@echo off
rem ============================================================
rem  One-click Git push (local -> GitHub): add + commit + push
rem  Real logic lives in git-push.ps1 (same folder).
rem ============================================================
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0git-push.ps1"
echo.
pause
