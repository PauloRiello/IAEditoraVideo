@echo off
rem IA Editora de Video - instalador para Windows. Textos sem acento de proposito.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Instalar.ps1" %*
echo.
pause
