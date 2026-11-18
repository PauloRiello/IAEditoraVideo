@echo off
rem IA Editora de Video - arquivo de atalho para Windows. Textos sem acento de proposito.
chcp 65001 >nul
cd /d "%~dp0.."
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao foi encontrado. Execute windows\Instalar.cmd primeiro.
  pause
  exit /b 1
)
node scripts\iniciar.mjs %*
if errorlevel 1 pause
