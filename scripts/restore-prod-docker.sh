#!/usr/bin/env bash
# Restaura um dump PostgreSQL (formato custom -Fc, como dump-prod-postgres.sh) no serviço `db` do Compose.
# Uso (na raiz do repositório, na VPS ou onde o stack está a correr):
#   chmod +x scripts/restore-prod-docker.sh
#   ./scripts/restore-prod-docker.sh /caminho/para/bwaproj_prod_YYYYMMDD_HHMMSS.dump.gz
#   ./scripts/restore-prod-docker.sh /caminho/para/arquivo.dump
#
# Variáveis opcionais:
#   COMPOSE_PROJECT_NAME=bwa_tech   (se o nome do projeto Compose não for o da pasta)
#   COMPOSE_DB_SERVICE=db           (nome do serviço Postgres no compose)
#
# ATENÇÃO: --clean --if-exists apaga objectos existentes no DB de destino antes de restaurar.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# shellcheck source=compose-project-name.sh
source "$SCRIPT_DIR/compose-project-name.sh"
resolve_compose_project_name

if [ "${#}" -lt 1 ]; then
  echo "Uso: $0 <ficheiro.dump.gz|ficheiro.dump>"
  exit 1
fi

DUMP_SRC="$1"
if [[ "$DUMP_SRC" != /* ]]; then
  DUMP_SRC="$(cd "$(dirname "$DUMP_SRC")" && pwd)/$(basename "$DUMP_SRC")"
fi
if [ ! -f "$DUMP_SRC" ]; then
  echo "Ficheiro não encontrado: $DUMP_SRC"
  exit 1
fi

DB_SVC="${COMPOSE_DB_SERVICE:-db}"
WORKDIR="/tmp"
DUMP_IN_CONTAINER="${WORKDIR}/bwaproj_restore.dump"

echo "Parando backend e Celery (libertar ligações ao Postgres)..."
docker compose stop backend celery-worker celery-beat 2>/dev/null || true

cleanup() {
  echo "A remover dump temporário no container..."
  docker compose exec -T "$DB_SVC" rm -f "$DUMP_IN_CONTAINER" 2>/dev/null || true
}
trap cleanup EXIT

if [[ "$DUMP_SRC" == *.gz ]]; then
  echo "A copiar .gz para o container e a descompactar..."
  docker compose cp -- "$DUMP_SRC" "${DB_SVC}:${WORKDIR}/restore.dump.gz"
  docker compose exec -T "$DB_SVC" sh -c "gunzip -c ${WORKDIR}/restore.dump.gz > ${DUMP_IN_CONTAINER} && rm -f ${WORKDIR}/restore.dump.gz"
else
  echo "A copiar dump para o container..."
  docker compose cp -- "$DUMP_SRC" "${DB_SVC}:${DUMP_IN_CONTAINER}"
fi

POSTGRES_USER="$(docker compose exec -T "$DB_SVC" printenv POSTGRES_USER 2>/dev/null | tr -d '\r' || true)"
POSTGRES_DB="$(docker compose exec -T "$DB_SVC" printenv POSTGRES_DB 2>/dev/null | tr -d '\r' || true)"
POSTGRES_USER="${POSTGRES_USER:-bwaproj}"
POSTGRES_DB="${POSTGRES_DB:-bwaproj_db}"

echo "A restaurar em ${POSTGRES_DB} (pg_restore --clean --if-exists)..."
docker compose exec -T "$DB_SVC" pg_restore \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  "$DUMP_IN_CONTAINER"

echo "A subir backend e Celery..."
docker compose start backend celery-worker celery-beat 2>/dev/null || docker compose up -d backend celery-worker celery-beat

echo "Pronto. Verifique: docker compose logs --tail=50 backend"
