@echo off
rem Dois cliques aqui rodam todos os testes do Jogo da Onça.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rodar-testes.ps1" %*
echo.
pause
