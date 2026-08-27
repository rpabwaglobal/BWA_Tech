@echo off
REM Sobe o Postgres e o Redis do BWA Tech em desenvolvimento.
REM
REM A logica fica em scripts\iniciar-infra-dev.ps1 para acompanhar o projeto no
REM git; este arquivo apenas prepara o console e o chama. Mesma divisao do
REM "sincronizar-banco-dev.bat" (o dump de producao), de onde vem o estilo.
REM
REM chcp 65001: sem UTF-8 as marcas de concluido saem como caixinha.
REM
REM ASCII PURO NESTE ARQUIVO. O cmd.exe le .bat como ANSI, nao como UTF-8:
REM acento e travessao viram bytes que ele tenta EXECUTAR, e o bat morre com
REM "nao e reconhecido como um comando interno". O texto com acento vive no .ps1,
REM que o PowerShell le em UTF-8 sem problema.

setlocal
chcp 65001 >nul 2>&1
title BWA Tech - Banco e Redis

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\iniciar-infra-dev.ps1" %*
set CODIGO=%ERRORLEVEL%

REM PAUSA SO NO DUPLO CLIQUE. Este e o unico bat que TERMINA (os outros seguram
REM um servidor ate o Ctrl+C), entao sem pausa a janela fecharia antes de dar
REM para ler o resultado. Mas um `pause` incondicional prenderia para sempre
REM quem chama o bat de um script ou de um gerenciador de processos - e sem
REM teclado ninguem aperta a tecla.
REM
REM Como se descobre: no duplo clique o Explorer roda `cmd /c "<caminho do bat>"`,
REM entao o proprio caminho aparece em %cmdcmdline%. Chamado de um console, nao.
REM
REM find.exe PELO CAMINHO COMPLETO, e nao so `find`. Quem tem Git instalado tem
REM o find do Unix no PATH, e ele vence o do Windows: o `where find` desta
REM maquina responde primeiro "C:\Program Files\Git\usr\bin\find.exe", que nao
REM entende /i e cospe "find: '/i': No such file or directory" na tela. Ou seja,
REM quebrava exatamente na maquina de quem desenvolve.
echo %cmdcmdline% | %SystemRoot%\System32\find.exe /i "%~0" >nul
if not errorlevel 1 pause

exit /b %CODIGO%
