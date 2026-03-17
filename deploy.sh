#!/bin/bash
# GerProj/BWAproj - Deploy no Linux (equivalente ao deploy.bat do Windows)
# Uso: ./deploy.sh   ou   bash deploy.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Credenciais do superadmin. Altere via variáveis de ambiente se precisar.
SU_USER="${ADMIN_USERNAME:-italoadmin}"
SU_PASS="${ADMIN_PASSWORD:-Italommf@45}"
SU_EMAIL="${ADMIN_EMAIL:-italoadmin@bwatech.local}"
export COMPOSE_PROJECT_NAME=bwaproj

echo ""
echo "  ╔══════════════════════════════════════════════════════════════════╗"
echo "  ║                                                                  ║"
echo "  ║     B W A p r o j   -   D e p l o y   C o m p l e t o            ║"
echo "  ║     Banco | Backend | Frontend | WebSocket                       ║"
echo "  ║                                                                  ║"
echo "  ╚══════════════════════════════════════════════════════════════════╝"
echo ""

# ─── 1. Baixar alterações do Git ─────────────────────────────────────
echo " [1/7] Baixando alterações do Git..."
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    set +e
    git pull
    PULL_ERR=$?
    set -e
    if [ $PULL_ERR -eq 0 ]; then
        echo " [OK] Git atualizado."
    else
        echo " [AVISO] git pull falhou. Continuando com o deploy..."
    fi
else
    echo " [INFO] Pasta não é um repositório Git; pulando git pull."
fi
echo ""

# ─── 2. Verificar Docker ─────────────────────────────────────────────
echo " [2/7] Verificando Docker..."
if ! docker info >/dev/null 2>&1; then
    echo ""
    echo " [ERRO] Docker não está rodando ou não está instalado."
    echo "        Inicie o Docker e execute este script novamente."
    echo ""
    exit 1
fi
echo " [OK] Docker disponível."
echo ""

# ─── 3. Parar containers ativos e subir serviços ──────────────────────
echo " [3/7] Parando containers ativos do projeto..."
docker compose down >/dev/null 2>&1 || true
echo " [3/7] Subindo containers (banco + backend + frontend)..."
APP_PORT=8000
for p in 8000 8001 8002 8003 8004 8005 8006 8007 8008 8009 8010; do
    if ! (ss -tln 2>/dev/null | grep -q ":${p} ") && ! (netstat -tln 2>/dev/null | grep -q ":${p} "); then
        APP_PORT=$p
        break
    fi
done
# IP da máquina na rede (para acesso de outros PCs)
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$SERVER_IP" ] && SERVER_IP=$(ip route get 1 2>/dev/null | awk '{print $7; exit}')
[ -z "$SERVER_IP" ] && SERVER_IP="127.0.0.1"
# Django: aceitar acesso por localhost e pelo IP da rede
export ALLOWED_HOSTS="localhost,127.0.0.1,${SERVER_IP}"
export CORS_ALLOWED_ORIGINS="http://localhost:${APP_PORT},http://127.0.0.1:${APP_PORT},http://${SERVER_IP}:${APP_PORT}"
export CSRF_TRUSTED_ORIGINS="http://localhost:${APP_PORT},http://127.0.0.1:${APP_PORT},http://${SERVER_IP}:${APP_PORT}"
if [ "$APP_PORT" != "8000" ]; then
    echo " [INFO] Porta 8000 em uso. Usando porta $APP_PORT."
fi
export APP_PORT
echo ""
if ! docker compose up -d --build; then
    echo ""
    echo " [ERRO] Falha ao subir os containers."
    exit 1
fi
echo ""
echo " [OK] Containers iniciados (porta $APP_PORT)."
echo ""

# ─── 4. Aguardar backend responder ──────────────────────────────────
echo " [4/7] Aguardando backend ficar pronto (migrações + collectstatic na 1ª vez)..."
echo " [INFO] Espera inicial 35s para migrate/collectstatic..."
sleep 35

MAX_TENT=50
if command -v curl >/dev/null 2>&1; then
    TENT=0
    while [ "$TENT" -lt "$MAX_TENT" ]; do
        TENT=$((TENT + 1))
        if CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "http://localhost:${APP_PORT}/api/" 2>/dev/null) && [ "$CODE" = "200" ]; then
            echo " [OK] Backend respondendo."
            break
        fi
        if [ "$TENT" -eq "$MAX_TENT" ]; then
            echo " [AVISO] Timeout. Verifique: docker compose logs backend"
        else
            echo "  Tentativa ${TENT}/${MAX_TENT}..."
            sleep 3
        fi
    done
else
    echo " [INFO] curl não encontrado. Aguardando mais 60 segundos..."
    sleep 60
fi
echo ""

# ─── 5. Criar superadmin (se ainda não existir) ───────────────────────
echo " [5/7] Superadmin do sistema (perfil admin)..."
if docker compose exec -T \
    -e DJANGO_SUPERUSER_USERNAME="$SU_USER" \
    -e DJANGO_SUPERUSER_PASSWORD="$SU_PASS" \
    -e DJANGO_SUPERUSER_EMAIL="$SU_EMAIL" \
    backend python manage.py createsuperuser --noinput 2>/dev/null; then
    echo " [OK] Superadmin criado: $SU_USER"
else
    echo " [OK] Superadmin \"$SU_USER\" já existe; nada a criar."
fi
docker compose exec -T backend python manage.py ensure_superadmin_role >/dev/null 2>&1 || true
echo ""

# ─── 6. Status dos serviços ────────────────────────────────────────
echo " [6/7] Status dos serviços:"
echo ""
docker compose ps
echo ""

# ─── 7. Resumo final ────────────────────────────────────────────────
echo " [7/7] Resumo"
echo " ┌─────────────────────────────────────────────────────────────────┐"
echo " │  DEPLOY CONCLUÍDO                                                │"
echo " ├─────────────────────────────────────────────────────────────────┤"
echo " │  Nesta máquina:  http://localhost:${APP_PORT}                        │"
if [ "$SERVER_IP" != "127.0.0.1" ]; then
echo " │  Na rede (outros PCs): http://${SERVER_IP}:${APP_PORT}                    │"
echo " │  Admin na rede:  http://${SERVER_IP}:${APP_PORT}/admin/                   │"
fi
echo " ├─────────────────────────────────────────────────────────────────┤"
echo " │  Logs:       docker compose logs -f backend                      │"
echo " │  Parar:      docker compose down                                 │"
echo " │  Firewall:   se outros PCs não acessarem: sudo ufw allow ${APP_PORT}/tcp  │"
echo " └─────────────────────────────────────────────────────────────────┘"
echo ""

# Encerrar sem abrir navegador nem pausar a sessão (útil para uso via SSH/CI)
exit 0
