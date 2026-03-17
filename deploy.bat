@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1
title BWAproj - Deploy

:: Credenciais do superadmin do sistema. Altere via .env (ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL) se precisar.
if defined ADMIN_USERNAME (set "SU_USER=!ADMIN_USERNAME!") else (set "SU_USER=italoadmin")
if defined ADMIN_PASSWORD (set "SU_PASS=!ADMIN_PASSWORD!") else (set "SU_PASS=Italommf@45")
if defined ADMIN_EMAIL (set "SU_EMAIL=!ADMIN_EMAIL!") else (set "SU_EMAIL=italoadmin@bwatech.local")

set "COMPOSE_PROJECT_NAME=bwaproj"
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

:header
color 0B
echo.
echo  ╔══════════════════════════════════════════════════════════════════╗
echo  ║                                                                  ║
echo  ║     B W A p r o j   -   D e p l o y   C o m p l e t o            ║
echo  ║     Banco ^| Backend ^| Frontend ^| WebSocket                     ║
echo  ║                                                                  ║
echo  ╚══════════════════════════════════════════════════════════════════╝
echo.
color 07

:: ─── 1. Baixar alterações do Git ─────────────────────────────────────
echo  [1/7] Baixando alteracoes do Git...
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo  [INFO] Pasta nao e um repositorio Git; pulando git pull.
    color 07
) else (
    git pull 2>nul
    if errorlevel 1 (
        color 0E
        echo  [AVISO] git pull falhou. Continuando com o deploy...
        color 07
    ) else (
        color 0A
        echo  [OK] Git atualizado.
        color 07
    )
)
echo.

:: ─── 2. Verificar Docker ─────────────────────────────────────────────
echo  [2/7] Verificando Docker...
docker info >nul 2>&1
if errorlevel 1 (
    color 0C
    echo.
    echo  [ERRO] Docker nao esta rodando ou nao esta instalado.
    echo         Inicie o Docker Desktop e execute este script novamente.
    echo.
    color 07
    pause
    exit /b 1
)
color 0A
echo  [OK] Docker disponivel.
echo.
color 07

:: ─── 3. Parar containers ativos e subir serviços ──────────────────────
echo  [3/7] Parando containers ativos do projeto...
docker compose down >nul 2>&1
echo  [3/7] Subindo containers ^(banco + backend + frontend^)...
set "APP_PORT=8000"
for /L %%p in (8000,1,8010) do (
    netstat -an 2>nul | find ":%%p " >nul 2>&1
    if errorlevel 1 (
        set "APP_PORT=%%p"
        goto port_found
    )
)
:port_found
if not "%APP_PORT%"=="8000" (
    echo  [INFO] Porta 8000 em uso. Usando porta %APP_PORT%.
    set "CORS_ALLOWED_ORIGINS=http://localhost:%APP_PORT%,http://127.0.0.1:%APP_PORT%"
    set "CSRF_TRUSTED_ORIGINS=http://localhost:%APP_PORT%,http://127.0.0.1:%APP_PORT%"
)
echo.
docker compose up -d --build
if errorlevel 1 (
    color 0C
    echo.
    echo  [ERRO] Falha ao subir os containers.
    color 07
    pause
    exit /b 1
)
color 0A
echo.
echo  [OK] Containers iniciados ^(porta %APP_PORT%^).
echo.
color 07

:: ─── 4. Aguardar backend responder ──────────────────────────────────
echo  [4/7] Aguardando backend ficar pronto ^(migracoes + collectstatic na 1a vez^)...
echo  [INFO] Espera inicial 35s para migrate/collectstatic...
ping -n 36 127.0.0.1 >nul 2>&1
set "TENT=0"
set "MAX_TENT=50"
where curl >nul 2>&1
if errorlevel 1 (
    echo  [INFO] curl nao encontrado. Aguardando mais 60 segundos...
    ping -n 61 127.0.0.1 >nul 2>&1
    goto check_superuser
)

:wait_backend
set /a TENT+=1
if !TENT! gtr %MAX_TENT% (
    color 0E
    echo  [AVISO] Timeout. Verifique: docker compose logs backend
    goto check_superuser
)
curl -s -S --connect-timeout 5 -o nul -w "%%{http_code}" http://localhost:%APP_PORT%/api/ 2>nul | find "200" >nul 2>&1
if errorlevel 1 (
    ping -n 4 127.0.0.1 >nul 2>&1
    <nul set /p="  Tentativa !TENT!/%MAX_TENT%..."
    echo.
    goto wait_backend
)
color 0A
echo  [OK] Backend respondendo.
echo.
color 07

:: ─── 5. Criar superadmin (se ainda não existir) ───────────────────────
:check_superuser
echo  [5/7] Superadmin do sistema ^(perfil admin^)...

docker compose exec -T -e DJANGO_SUPERUSER_USERNAME=%SU_USER% -e DJANGO_SUPERUSER_PASSWORD=%SU_PASS% -e DJANGO_SUPERUSER_EMAIL=%SU_EMAIL% backend python manage.py createsuperuser --noinput 2>nul
if errorlevel 1 (
    color 0A
    echo  [OK] Superadmin "%SU_USER%" ja existe; nada a criar.
    color 07
) else (
    color 0A
    echo  [OK] Superadmin criado: %SU_USER%
    color 07
)
docker compose exec -T backend python manage.py ensure_superadmin_role >nul 2>&1
echo.

:: ─── 6. Status dos serviços ────────────────────────────────────────
echo  [6/7] Status dos servicos:
echo.
docker compose ps
echo.

:: ─── 7. Resumo final ────────────────────────────────────────────────
echo  [7/7] Resumo
color 0B
echo  ┌─────────────────────────────────────────────────────────────────┐
echo  │  DEPLOY CONCLUIDO                                                │
echo  ├─────────────────────────────────────────────────────────────────┤
echo  │  Aplicacao:  http://localhost:%APP_PORT%                               │
echo  │  API:        http://localhost:%APP_PORT%/api/                          │
echo  │  Admin:      http://localhost:%APP_PORT%/admin/                        │
echo  ├─────────────────────────────────────────────────────────────────┤
echo  │  Logs:       docker compose logs -f backend                      │
echo  │  Parar:      docker compose down                                 │
echo  └─────────────────────────────────────────────────────────────────┘
color 07
echo.

rem Encerrar sem abrir navegador nem pausar a sessão
exit /b 0
