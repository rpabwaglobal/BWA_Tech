@echo off
REM Traz o banco de producao para o ambiente de desenvolvimento.
REM   VPS (pg_dump) -> scp -> Postgres local (Docker) -> migrate
REM
REM A logica fica em scripts\sincronizar-banco-dev.ps1 para acompanhar o
REM projeto no git; este arquivo prepara o console e o chama.
REM
REM chcp 65001: sem UTF-8 o painel de etapas imprime caixinha no lugar do
REM spinner e das marcas de concluido.

setlocal
chcp 65001 >nul 2>&1
title BWA Tech - dump de producao para dev
mode con: cols=94 lines=34 >nul 2>&1

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\sincronizar-banco-dev.ps1" %*
set CODIGO=%ERRORLEVEL%

echo.
if %CODIGO% NEQ 0 (
    echo   Terminou com erro. A saida completa esta no log indicado acima.
)
echo   Pressione qualquer tecla para fechar.
pause >nul
endlocal
