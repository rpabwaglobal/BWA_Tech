@echo off
REM Inicia o Celery Worker do BWA Tech em desenvolvimento.
REM
REM A logica fica em scripts$script para acompanhar o projeto no
REM git; este arquivo apenas prepara o console e o chama. Mesma divisao do
REM "sincronizar-banco-dev.bat" (o dump de producao), de onde vem o estilo.
REM
REM chcp 65001: sem UTF-8 as marcas de concluido saem como caixinha.
REM
REM ASCII PURO NESTE ARQUIVO. O cmd.exe le .bat como ANSI, nao como UTF-8:
REM acento e travessao viram bytes que ele tenta EXECUTAR, e o bat morre com
REM "nao e reconhecido como um comando interno". O texto com acento vive no .ps1,
REM que o PowerShell le em UTF-8 sem problema.
REM
REM SEM `pause` NO FIM: este bat e feito para rodar sob um gerenciador de
REM processos, que nao tem teclado para atender a pergunta - ele ficaria preso
REM para sempre. Rodando por duplo clique, a janela fecha junto com o processo,
REM que e o comportamento esperado de quem para o servico com Ctrl+C.

setlocal
chcp 65001 >nul 2>&1
title BWA Tech - Celery Worker

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\iniciar-celery-worker-dev.ps1" %*
exit /b %ERRORLEVEL%
