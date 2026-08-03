#!/usr/bin/env bash
# Backup diário automático do PostgreSQL na VPS (/opt/bwa_tech).
# Faz pg_dump -Fc do banco no container, grava em backups/ com nome datado,
# valida o tamanho do arquivo e apaga os backups fora da janela de retenção.
#
# AGENDAMENTO (crontab do root na VPS — `sudo crontab -e`):
#   MAILTO=rpa@bwa.global
#   0 3 * * * bash /opt/bwa_tech/scripts/backup-diario.sh
#
# Invocado por `bash` de propósito: o repositório é clonado a partir de uma
# máquina Windows (core.fileMode=false), então o bit de execução não sobrevive
# ao `git pull` e o cron falharia em silêncio com 'Permission denied'.
#
# O script escreve o próprio log em backups/backup-diario.log e, em execução não
# interactiva, só imprime em stdout/stderr quando algo falha — assim o cron manda
# e-mail apenas nos dias com problema, e não todos os dias.
# Antes de agendar: chmod +x scripts/backup-diario.sh && ./scripts/backup-diario.sh
#
# RESTAURAR a partir de um backup diário (na raiz do projeto, na VPS):
#   ls -lh backups/                       # escolher o arquivo pela data
#   ./scripts/restore-prod-docker.sh backups/bwa_tech_diario_YYYYMMDD_HHMMSS.dump.gz
# (o restore para backend e Celery, faz pg_restore --clean --if-exists e sobe tudo de volta)
# Para restaurar no PC de dev: baixar o .dump.gz e usar .\scripts\restore-local-docker.ps1
#
# Variáveis opcionais:
#   BACKUP_DIR=/opt/bwa_tech/backups   pasta de destino (default: <raiz>/backups)
#   BACKUP_RETENCAO_DIAS=14            quantos dias de backup manter
#   BACKUP_MIN_BYTES=51200             piso absoluto de tamanho do .dump.gz
#   BACKUP_QUEDA_PCT=70                % mínimo do tamanho do backup anterior
#   BACKUP_VERBOSE=1                   força o log também em stdout (útil para testar)
#   COMPOSE_DB_SERVICE=db              nome do serviço Postgres no compose
#   PG_DUMP_CONTAINER=bwa_tech-db-1    container do Postgres, se estiver fora do compose
#
# Códigos de saída: 0 sucesso · 1 configuração inválida · 2 falha ao gerar o dump
#                   3 dump suspeito (vazio ou muito menor que o anterior)

set -euo pipefail
# umask 0077: dump e log criados com permissão 0600 (somente owner lê).
umask 0077
# O cron roda com PATH mínimo e sem o perfil do shell — sem isto o `docker` não é encontrado.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin${PATH:+:$PATH}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
LOG="${BACKUP_LOG:-$BACKUP_DIR/backup-diario.log}"
LOG_MAX_LINHAS="${BACKUP_LOG_MAX_LINHAS:-5000}"
RETENCAO_DIAS="${BACKUP_RETENCAO_DIAS:-14}"
MIN_BYTES="${BACKUP_MIN_BYTES:-51200}"
QUEDA_PCT="${BACKUP_QUEDA_PCT:-70}"

# Prefixo próprio do backup automático: a retenção só apaga arquivos que casem com ele,
# nunca toca nos dumps manuais (bwaproj_prod_*) que alguém deixou na mesma pasta.
PREFIXO="bwa_tech_diario"
# Glob restrito ao formato gerado aqui: PREFIXO_AAAAMMDD_HHMMSS.dump.gz (+ sufixos de erro).
GLOB_PROPRIO="${PREFIXO}_????????_??????.dump.gz*"

mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR" 2>/dev/null || true

# Em execução interactiva mostra o andamento; sob cron fica silencioso (ver cabeçalho).
VERBOSE="${BACKUP_VERBOSE:-}"
if [ -z "$VERBOSE" ]; then
  if [ -t 1 ]; then VERBOSE=1; else VERBOSE=0; fi
fi

log() {
  local linha
  linha="$(date '+%Y-%m-%d %H:%M:%S') [ok] $*"
  printf '%s\n' "$linha" >> "$LOG"
  if [ "$VERBOSE" = "1" ]; then
    printf '%s\n' "$linha"
  fi
}

# Erro vai sempre para stderr — é o que faz o cron avisar por e-mail.
erro() {
  local linha
  linha="$(date '+%Y-%m-%d %H:%M:%S') [ERRO] $*"
  printf '%s\n' "$linha" >> "$LOG"
  printf '%s\n' "$linha" >&2
}

tamanho_de() {
  stat -c %s "$1" 2>/dev/null || echo 0
}

# Formata bytes só para o log ficar legível.
humano() {
  numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "$1 bytes"
}

for par in "RETENCAO_DIAS:$RETENCAO_DIAS" "MIN_BYTES:$MIN_BYTES" "QUEDA_PCT:$QUEDA_PCT" \
           "LOG_MAX_LINHAS:$LOG_MAX_LINHAS"; do
  if ! [[ "${par#*:}" =~ ^[0-9]+$ ]]; then
    erro "Valor inválido para ${par%%:*}: '${par#*:}' (esperado número inteiro)."
    exit 1
  fi
done
if [ "$RETENCAO_DIAS" -lt 1 ]; then
  erro "BACKUP_RETENCAO_DIAS precisa ser >= 1 (recebido: ${RETENCAO_DIAS})."
  exit 1
fi

# Duas execuções ao mesmo tempo (cron atrasado + execução manual) escreveriam no mesmo
# arquivo e falseariam a comparação de tamanho.
exec 9>"$BACKUP_DIR/.backup-diario.lock"
if command -v flock >/dev/null 2>&1 && ! flock -n 9; then
  erro "Já existe um backup em andamento (lock em $BACKUP_DIR/.backup-diario.lock)."
  exit 1
fi

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="${BACKUP_DIR}/${PREFIXO}_${STAMP}.dump.gz"
# Escreve em .parcial e só renomeia no fim: um dump interrompido nunca vira um arquivo
# com cara de backup bom (e, pior, a referência de tamanho do dia seguinte).
PARCIAL="${OUT}.parcial"
ERR_PG="$(mktemp)"

cleanup() {
  rm -f "$PARCIAL" "$ERR_PG" 2>/dev/null || true
}
trap cleanup EXIT

# bwaproj (local) vs bwa_tech (VPS /opt/bwa_tech) — ver compose-project-name.sh
# shellcheck source=compose-project-name.sh
source "$SCRIPT_DIR/compose-project-name.sh"
resolve_compose_project_name

DB_SVC="${COMPOSE_DB_SERVICE:-db}"
CTR="${PG_DUMP_CONTAINER:-}"
if [ -z "$CTR" ]; then
  CTR="$(docker compose ps -q "$DB_SVC" 2>/dev/null | head -n1 || true)"
fi
if [ -z "$CTR" ]; then
  erro "Container do Postgres não encontrado (projeto '${COMPOSE_PROJECT_NAME}', serviço '${DB_SVC}')."
  erro "Verifique com 'docker compose ps -a' ou defina COMPOSE_DB_SERVICE / PG_DUMP_CONTAINER."
  exit 2
fi
if ! docker exec "$CTR" true 2>/dev/null; then
  erro "Container '${CTR}' não responde (parado?). Verifique com 'docker compose ps -a'."
  exit 2
fi

# Sem -i/-t: nada é escrito no stdin do container e o cron não tem TTY para alocar.
POSTGRES_USER="$(docker exec "$CTR" printenv POSTGRES_USER 2>/dev/null | tr -d '\r' || true)"
POSTGRES_DB="$(docker exec "$CTR" printenv POSTGRES_DB 2>/dev/null | tr -d '\r' || true)"
POSTGRES_USER="${POSTGRES_USER:-bwaproj}"
POSTGRES_DB="${POSTGRES_DB:-bwaproj_db}"

log "Iniciando backup de ${POSTGRES_DB} (container ${CTR}) em ${OUT}"

if ! docker exec "$CTR" pg_dump \
      -U "$POSTGRES_USER" \
      -d "$POSTGRES_DB" \
      -Fc \
      --no-owner \
      --no-acl \
      2>"$ERR_PG" \
      | gzip -c > "$PARCIAL"; then
  erro "pg_dump falhou para ${POSTGRES_DB} no container ${CTR}."
  while IFS= read -r l; do erro "  pg_dump: $l"; done < "$ERR_PG"
  exit 2
fi

TAM_NOVO="$(tamanho_de "$PARCIAL")"

# Último backup bom já existente (nomes datados ordenam cronologicamente no sort).
ANTERIOR=""
while IFS= read -r f; do
  ANTERIOR="$f"
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${PREFIXO}_????????_??????.dump.gz" | sort)

# Backup vazio/truncado é pior que backup nenhum: passa despercebido até a hora do rollback.
# O arquivo suspeito fica guardado com sufixo próprio para diagnóstico, mas fora do padrão
# que serve de referência de tamanho — assim um dump ruim não vira a base do dia seguinte.
reprovar() {
  mv -f "$PARCIAL" "${OUT}.suspeito" 2>/dev/null || true
  erro "$1"
  erro "Arquivo reprovado guardado em ${OUT}.suspeito — backups antigos NÃO foram apagados."
  exit 3
}

if [ "$TAM_NOVO" -lt "$MIN_BYTES" ]; then
  reprovar "Dump saiu com $(humano "$TAM_NOVO"), abaixo do mínimo de $(humano "$MIN_BYTES")."
fi

if [ -n "$ANTERIOR" ]; then
  TAM_ANT="$(tamanho_de "$ANTERIOR")"
  # Comparação em inteiros (sem bc): novo*100 vs anterior*percentual.
  if [ "$TAM_ANT" -gt 0 ] && [ $((TAM_NOVO * 100)) -lt $((TAM_ANT * QUEDA_PCT)) ]; then
    reprovar "Dump encolheu demais: $(humano "$TAM_NOVO") contra $(humano "$TAM_ANT") de $(basename "$ANTERIOR") (mínimo aceite: ${QUEDA_PCT}%)."
  fi
  log "Tamanho $(humano "$TAM_NOVO") (anterior: $(humano "$TAM_ANT"))"
else
  log "Tamanho $(humano "$TAM_NOVO") (primeiro backup — sem anterior para comparar)"
fi

mv -f "$PARCIAL" "$OUT"
chmod 0600 "$OUT" 2>/dev/null || true

# Retenção só depois do dump aprovado: se o backup do dia falhou, os antigos ficam intactos.
# `-mtime +N` pega o que tem mais de N dias completos, ou seja, guarda um dia a mais que o
# pedido — na dúvida entre apagar cedo e guardar demais, guarda-se demais.
REMOVIDOS=0
while IFS= read -r -d '' antigo; do
  rm -f -- "$antigo"
  log "Removido por retenção (> ${RETENCAO_DIAS} dias): $(basename "$antigo")"
  REMOVIDOS=$((REMOVIDOS + 1))
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$GLOB_PROPRIO" -mtime "+${RETENCAO_DIAS}" -print0)

RESTANTES="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${PREFIXO}_????????_??????.dump.gz" | wc -l)"
log "Backup concluído: $(basename "$OUT") · $(humano "$TAM_NOVO") · ${RESTANTES} backup(s) na pasta · ${REMOVIDOS} removido(s)"

# O log é anexado todo dia; sem poda ele cresce para sempre na VPS.
if [ "$LOG_MAX_LINHAS" -gt 0 ] && [ "$(wc -l < "$LOG")" -gt "$LOG_MAX_LINHAS" ]; then
  tail -n "$LOG_MAX_LINHAS" "$LOG" > "${LOG}.tmp" && mv -f "${LOG}.tmp" "$LOG"
fi
