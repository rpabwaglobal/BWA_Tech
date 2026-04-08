#!/usr/bin/env bash
# Gera dump do PostgreSQL do ambiente Docker no SERVIDOR DE PRODUÇÃO.
# Uso (no servidor, na pasta do projeto onde está o docker-compose.yml):
#   chmod +x scripts/dump-prod-postgres.sh
#   ./scripts/dump-prod-postgres.sh
# Depois copie o arquivo .dump.gz para sua máquina (scp, WinSCP, etc.).
#
# Requer: docker compose com o serviço "db" rodando (mesmo compose do deploy).

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

mkdir -p backups
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="backups/bwaproj_prod_${STAMP}.dump"

# Usa o mesmo usuário e banco que o container já tem (reflete .env de produção)
POSTGRES_USER="$(docker compose exec -T db printenv POSTGRES_USER 2>/dev/null | tr -d '\r' || true)"
POSTGRES_DB="$(docker compose exec -T db printenv POSTGRES_DB 2>/dev/null | tr -d '\r' || true)"
POSTGRES_USER="${POSTGRES_USER:-bwaproj}"
POSTGRES_DB="${POSTGRES_DB:-bwaproj_db}"

echo "Gerando dump (formato custom -Fc) em $OUT ..."
docker compose exec -T db pg_dump \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -Fc \
  --no-owner \
  --no-acl \
  > "$OUT"

gzip -f "$OUT"
echo "Pronto: ${OUT}.gz"
echo "Copie esse arquivo para o PC de desenvolvimento e use scripts/restore-local-docker.ps1"
