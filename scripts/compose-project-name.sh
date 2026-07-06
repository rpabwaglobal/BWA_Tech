#!/usr/bin/env bash
# Define COMPOSE_PROJECT_NAME quando não foi exportado pelo utilizador.
# Produção (Hostinger): bwa_tech — ver .github/workflows/hostinger-deploy.yml
# Dev local (deploy.bat / deploy.sh): bwaproj
#
# Uso (após definir ROOT = raiz do repositório):
#   source "$SCRIPT_DIR/compose-project-name.sh"
#   resolve_compose_project_name

resolve_compose_project_name() {
  if [ -n "${COMPOSE_PROJECT_NAME:-}" ]; then
    return 0
  fi

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qE '^bwa_tech-db-'; then
    export COMPOSE_PROJECT_NAME=bwa_tech
    return 0
  fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qE '^bwaproj-db-'; then
    export COMPOSE_PROJECT_NAME=bwaproj
    return 0
  fi

  local base=""
  if [ -n "${ROOT:-}" ]; then
    base="$(basename "$ROOT" | tr '[:upper:]' '[:lower:]')"
  fi
  if [ "$base" = "bwa_tech" ] || [ "${ROOT:-}" = "/opt/bwa_tech" ]; then
    export COMPOSE_PROJECT_NAME=bwa_tech
    return 0
  fi

  export COMPOSE_PROJECT_NAME=bwaproj
}
