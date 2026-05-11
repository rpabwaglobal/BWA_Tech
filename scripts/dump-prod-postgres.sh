#!/usr/bin/env bash
# Gera dump do PostgreSQL no SERVIDOR (VPS) — backup ou cópia para fora.
# Para migrar DO localhost PARA a VPS: faça dump no PC (pg_dump ou docker compose exec db …),
# envie o .dump.gz para a VPS e use scripts/restore-prod-docker.sh na pasta do projeto.
# Uso (na pasta onde está o docker-compose.yml):
#   chmod +x scripts/dump-prod-postgres.sh
#   ./scripts/dump-prod-postgres.sh
#
# Se o serviço do Postgres no compose não se chama "db":
#   COMPOSE_DB_SERVICE=nome_do_servico ./scripts/dump-prod-postgres.sh
#
# Se o Postgres NÃO está no Docker Compose (container solto ou outro nome):
#   PG_DUMP_CONTAINER=nome_ou_id_do_container ./scripts/dump-prod-postgres.sh
#
# Se o Postgres está instalado no Ubuntu (sem Docker):
#   DUMP_USE_HOST_PG=1 ./scripts/dump-prod-postgres.sh
# (usa pg_dump do sistema; defina PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE ou exporte do .env)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# Mesmo nome de projeto que deploy.sh e deploy.bat (linha COMPOSE_PROJECT_NAME=bwaproj).
# Sem isto, o Docker Compose usa o nome da pasta (ex.: GerProj → gerproj) e não encontra
# os containers do deploy — daí "service db is not running".
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-bwaproj}"

mkdir -p backups
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="backups/bwaproj_prod_${STAMP}.dump"

run_pg_dump_in_container() {
  local ctr="$1"
  local user db
  user="$(docker exec -T "$ctr" printenv POSTGRES_USER 2>/dev/null | tr -d '\r' || true)"
  db="$(docker exec -T "$ctr" printenv POSTGRES_DB 2>/dev/null | tr -d '\r' || true)"
  user="${user:-bwaproj}"
  db="${db:-bwaproj_db}"
  echo "Gerando dump (formato custom -Fc) em $OUT ..."
  docker exec -T "$ctr" pg_dump \
    -U "$user" \
    -d "$db" \
    -Fc \
    --no-owner \
    --no-acl
}

fail_with_help() {
  echo ""
  echo "  Não foi possível aceder ao PostgreSQL via Docker Compose."
  echo "  Diagnóstico rápido — rode na VPS e veja o que está ativo:"
  echo "    docker compose ps -a"
  echo "    docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'"
  echo ""
  echo "  Ajustes comuns:"
  echo "    • Subir o serviço do banco: docker compose up -d db   (ou o nome do serviço no seu compose)"
  echo "    • Se o serviço tiver outro nome: COMPOSE_DB_SERVICE=postgres ./scripts/dump-prod-postgres.sh"
  echo "    • Se souber o nome do container: PG_DUMP_CONTAINER=meu_container_postgres ./scripts/dump-prod-postgres.sh"
  echo "    • Postgres no Ubuntu (sem Docker): DUMP_USE_HOST_PG=1 ./scripts/dump-prod-postgres.sh"
  echo ""
  exit 1
}

if [ "${DUMP_USE_HOST_PG:-0}" = "1" ]; then
  if ! command -v pg_dump >/dev/null 2>&1; then
    echo "Instale o cliente PostgreSQL (ex.: sudo apt install postgresql-client) ou use Docker."
    exit 1
  fi
  echo "Gerando dump (formato custom -Fc) em $OUT ..."
  pg_dump -Fc --no-owner --no-acl > "$OUT"
  gzip -f "$OUT"
  echo "Pronto: ${OUT}.gz"
  exit 0
fi

if [ -n "${PG_DUMP_CONTAINER:-}" ]; then
  if ! docker ps --format '{{.Names}}' | grep -q "^${PG_DUMP_CONTAINER}$" && ! docker ps -q -f "id=${PG_DUMP_CONTAINER}" | grep -q .; then
    echo "Container não encontrado ou parado: ${PG_DUMP_CONTAINER}"
    fail_with_help
  fi
  run_pg_dump_in_container "$PG_DUMP_CONTAINER" > "$OUT"
  gzip -f "$OUT"
  echo "Pronto: ${OUT}.gz"
  exit 0
fi

DB_SVC="${COMPOSE_DB_SERVICE:-db}"

if ! docker compose exec -T "$DB_SVC" true 2>/dev/null; then
  echo "O serviço Compose '${DB_SVC}' não responde (parado ou nome errado)."
  echo "Estado do stack nesta pasta:"
  docker compose ps -a 2>/dev/null || true
  echo ""
  echo "Tente: COMPOSE_DB_SERVICE=<nome> ./scripts/dump-prod-postgres.sh"
  echo "   ou: PG_DUMP_CONTAINER=<container> ./scripts/dump-prod-postgres.sh"
  fail_with_help
fi

POSTGRES_USER="$(docker compose exec -T "$DB_SVC" printenv POSTGRES_USER 2>/dev/null | tr -d '\r' || true)"
POSTGRES_DB="$(docker compose exec -T "$DB_SVC" printenv POSTGRES_DB 2>/dev/null | tr -d '\r' || true)"
POSTGRES_USER="${POSTGRES_USER:-bwaproj}"
POSTGRES_DB="${POSTGRES_DB:-bwaproj_db}"

echo "Gerando dump (formato custom -Fc) em $OUT ..."
docker compose exec -T "$DB_SVC" pg_dump \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -Fc \
  --no-owner \
  --no-acl \
  > "$OUT"

gzip -f "$OUT"
echo "Pronto: ${OUT}.gz"
echo "Para restaurar na VPS (Linux): scripts/restore-prod-docker.sh"
echo "Para restaurar no Windows (dev): scripts/restore-local-docker.ps1"
