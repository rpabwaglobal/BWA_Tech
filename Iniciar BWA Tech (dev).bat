@echo off
setlocal EnableDelayedExpansion
title BWA Tech - Ambiente de Desenvolvimento
set "REPO=C:\Users\Italo.Martins\Documents\Github\BWA_Tech"
set "DOCKER_DESKTOP=C:\Program Files\Docker\Docker\Docker Desktop.exe"

cd /d "%REPO%" || (echo Nao encontrei o repositorio em "%REPO%". & pause & exit /b 1)

echo ==================================================
echo    BWA Tech - Iniciando ambiente de DESENVOLVIMENTO
echo ==================================================
echo.

REM ---------- 1/5 Docker ----------
echo [1/5] Verificando o Docker...
docker info >nul 2>&1
if errorlevel 1 (
  echo    Docker esta parado. Abrindo o Docker Desktop...
  start "" "%DOCKER_DESKTOP%"
  echo    Aguardando o Docker iniciar ^(pode levar 1-2 minutos^)...
  :waitdocker
  timeout /t 5 /nobreak >nul
  docker info >nul 2>&1
  if errorlevel 1 goto waitdocker
)
echo    Docker OK.
echo.

REM ---------- 2/5 Banco + Redis ----------
echo [2/5] Subindo Postgres e Redis via docker compose...
docker compose up -d db redis
if errorlevel 1 (
  echo    ERRO ao subir os containers do banco/redis. Abortando.
  pause
  exit /b 1
)
echo    Aguardando o banco ficar saudavel...
:waitdb
set "DBH="
for /f "delims=" %%s in ('docker inspect -f "{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}" bwa_tech-db-1 2^>nul') do set "DBH=%%s"
if /i not "!DBH!"=="healthy" (
  timeout /t 3 /nobreak >nul
  goto waitdb
)
echo    Banco pronto ^(healthy^).
echo.

REM ---------- 3/5 Backend ----------
echo [3/5] Iniciando backend ^(Django/Daphne^) em janela propria...
start "BWA Tech - Backend" cmd /k "cd /d %REPO%\backend && python manage.py migrate && python manage.py runserver 127.0.0.1:8000"

REM ---------- 4/5 Celery ----------
echo [4/5] Iniciando Celery worker e beat em janelas proprias...
start "BWA Tech - Celery Worker" cmd /k "cd /d %REPO%\backend && python -m celery -A config.celery worker --loglevel=INFO --pool=solo"
start "BWA Tech - Celery Beat" cmd /k "cd /d %REPO%\backend && python -m celery -A config.celery beat --loglevel=INFO"

REM ---------- 5/5 Frontend ----------
echo [5/5] Iniciando frontend ^(Vite^) em janela propria...
start "BWA Tech - Frontend" cmd /k "cd /d %REPO%\frontend && npm run dev"

REM ---------- Navegador ----------
echo.
echo    Aguardando o frontend subir para abrir o navegador...
timeout /t 9 /nobreak >nul
start "" "http://localhost:5173"

echo.
echo ==================================================
echo    Tudo iniciado! Servicos em janelas proprias:
echo      Frontend : http://localhost:5173
echo      Backend  : http://127.0.0.1:8000
echo      Banco    : Docker container bwa_tech-db-1
echo      Redis    : Docker container bwa_tech-redis-1
echo      Celery   : worker + beat
echo ==================================================
echo    Para PARAR: feche as janelas de Backend/Celery/Frontend.
echo    O banco/Redis seguem no Docker ^(pare pelo Docker Desktop se quiser^).
echo.
echo    Esta janela fecha em 12 segundos...
timeout /t 12 /nobreak >nul
endlocal
