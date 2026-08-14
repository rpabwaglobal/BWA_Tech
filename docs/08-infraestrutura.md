# Infraestrutura e deploy

> Parte da [Documentação de Arquitetura do BWA Tech](README.md).
> Levantada por leitura direta do código; o que não foi confirmado está
> em [Riscos e lacunas](12-riscos-e-lacunas.md).


## Infraestrutura, deploy e operação

A infraestrutura do BWA Tech é uma imagem Docker única (multi-stage: Vite builda o frontend, o estágio final é Python 3.12 rodando Daphne como usuário não-root UID 10001) orquestrada por um `docker-compose.yml` de quatro serviços: `db` (Postgres 16.6-alpine), `redis` (7.4-alpine com senha e sem persistência), `backend` (Daphne/ASGI, também serve a SPA e o /media/) e dois processos Celery (`celery-worker` e `celery-beat`) que reutilizam a mesma imagem trocando o `command`. O CI/CD tem dois workflows encadeados: `docker-publish.yml` builda e publica `ghcr.io/rpabwaglobal/bwa_tech:latest` a cada push em `main` (com filtro de paths), e `hostinger-deploy.yml` dispara por `workflow_run` ao fim do build, entra por SSH na VPS Hostinger, faz `git reset --hard origin/main` em `/opt/bwa_tech`, `docker compose pull` e `docker compose up -d`. Exposição pública é só via Traefik (rede externa `web`, labels no serviço `backend`, TLS por certresolver); as portas do compose são todas bindadas em 127.0.0.1. Não há build local em produção, não há staging, não há testes no pipeline e não há rollback automatizado — a tag desplegada é sempre `latest`. O desenvolvimento local NÃO usa a imagem: `iniciar-dev.bat` sobe só `db` e `redis` no Docker e roda Django, Celery worker/beat e Vite nativamente em janelas separadas do Windows.

### CI/CD completo — push em main até container novo na VPS

1. Push em `main` toca um dos paths vigiados (Dockerfile, backend/**, frontend/**, .env, .dockerignore, .github/workflows/docker-publish.yml) — ou alguém clica Run workflow.
2. `Build and publish Docker image` roda em ubuntu-latest: checkout, setup-buildx, login em ghcr.io com o GITHUB_TOKEN (permissions: packages: write).
3. docker/metadata-action@v5 gera as tags `latest` e `sha-<curto>`; build-push-action@v5 builda com context `.` e empurra, usando cache-from/cache-to em `ghcr.io/<owner>/bwa_tech:buildcache` (mode=max).
4. Ao terminar com sucesso, o evento `workflow_run` dispara `Deploy to Hostinger VPS` (o job só roda se conclusion == success, ou se veio de push/dispatch).
5. appleboy/ssh-action entra na VPS (secrets VPS_HOST, VPS_USER, VPS_SSH_KEY, VPS_SSH_PORT) exportando COMPOSE_PROJECT_NAME=bwa_tech.
6. Aborta se GHCR_PULL_TOKEN ou GHCR_USERNAME não estiverem definidos; senão faz `docker login ghcr.io --password-stdin`.
7. Se /opt/bwa_tech/.git não existe, `git clone https://github.com/rpabwaglobal/BWA_Tech.git`; se existe, `git fetch origin main && git reset --hard origin/main` — isto reescreve o `.env` da VPS com a versão do repositório.
8. `docker compose pull` puxa a imagem `:latest` recém-publicada.
9. `docker compose up -d --remove-orphans` recria os containers afetados; volumes nomeados (postgres_data, backend_media, redis_data) são preservados.
10. `docker image prune -f` e `docker compose ps` para status final.

### O que roda na subida do container backend

1. Compose espera `db` healthy (pg_isready) e `redis` healthy (redis-cli -a $REDIS_PASSWORD ping) — condition: service_healthy em ambos.
2. O container sobe com o CMD do Dockerfile: `sh -c "python manage.py migrate --noinput && python manage.py collectstatic --noinput && daphne -b 0.0.0.0 -p 8000 config.asgi:application"`.
3. Ou seja: migrations E collectstatic rodam a CADA start do container, inclusive em produção.
4. collectstatic escreve em /app/backend/staticfiles, que NÃO é volume — é descartado a cada recriação e refeito na próxima.
5. Daphne serve HTTP e WebSocket (config/asgi.py: ProtocolTypeRouter com LoggingOriginValidator + AuthMiddlewareStack sobre apps.projects.routing).
6. O mesmo processo Django serve a SPA (serve_spa lê /app/frontend/dist, copiado do estágio de build) e /media/ (serve_media), e o WhiteNoise serve /static/ do admin.
7. HEALTHCHECK do Dockerfile: a cada 30s, `curl -fsS http://localhost:8000/api/` (start-period 20s, 3 retries).
8. celery-worker e celery-beat sobem em paralelo com `depends_on: backend → service_started` (NÃO service_healthy), sobrescrevendo o command da imagem — portanto não rodam migrate nem collectstatic.

### Desenvolvimento local (Windows) — iniciar-dev.bat

1. Verifica `docker info`; se falhar, abre o Docker Desktop e fica em loop até responder.
2. `docker compose up -d db redis` — só o banco e o Redis vão para o Docker; nada de imagem da aplicação.
3. Loop de espera até `docker inspect bwa_tech-db-1` reportar health = healthy.
4. Abre janela "Backend": `cd backend && python manage.py migrate && python manage.py runserver 127.0.0.1:8000` (com `daphne` primeiro em INSTALLED_APPS, o runserver usa o handler ASGI e WebSocket funciona).
5. Abre janela "Celery Worker": `python -m celery -A config.celery worker --loglevel=INFO --pool=solo` (pool solo por causa do Windows).
6. Abre janela "Celery Beat": `python -m celery -A config.celery beat --loglevel=INFO`.
7. Abre janela "Frontend": `cd frontend && npm run dev` (Vite em 5173, lendo frontend/.env.development).
8. Espera 9s e abre http://localhost:5173 no navegador.
9. Para conectar em Redis e Postgres do host, settings.py reescreve `@redis:` → `@127.0.0.1:` quando o hostname `redis` não resolve, e o mesmo teste desliga BEHIND_HTTPS_PROXY — mas o Redis só tem porta publicada se docker-compose.override.yml existir (arquivo gitignored).

### Deploy manual (deploy.sh / deploy.bat)

1. Exige ADMIN_USERNAME, ADMIN_PASSWORD e ADMIN_EMAIL no ambiente — sai com erro 1 se faltar algum.
2. Exporta COMPOSE_PROJECT_NAME=bwaproj (diferente do `bwa_tech` usado pelo CI/CD).
3. git pull (avisa e continua se falhar), checa `docker info`, cria a rede externa `web` se não existir.
4. Varre as portas 8000..8010 e exporta a primeira livre como APP_PORT; detecta o IP da máquina para o resumo final.
5. Recusa DEPLOY_LAN_EXPOSE=1 (flag removida) e faz `unset HOST_BIND` para que o valor do .env (127.0.0.1) prevaleça.
6. `docker compose down` e depois `docker compose up -d --build` — mas como nenhum serviço tem `build:`, nada é buildado localmente; a imagem vem do GHCR.
7. Espera 10s, roda `docker compose exec -T backend python manage.py migrate` com até 10 tentativas espaçadas de 5s.
8. Faz polling de `curl http://localhost:$APP_PORT/api/` até responder 200 (máx. 50 tentativas × 3s).
9. Cria o superadmin via `createsuperuser --noinput` com DJANGO_SUPERUSER_* e roda `ensure_superadmin_role` e `agendar_fechamento_sprints_abertas` (ambos com erro suprimido).
10. Imprime `docker compose ps` e um resumo com URLs e comandos de log.

### Backup diário do Postgres em produção

1. crontab do root na VPS: `MAILTO=rpa@bwa.global` + `0 3 * * * bash /opt/bwa_tech/scripts/backup-diario.sh` (invocado por `bash` porque o bit de execução não sobrevive ao git clone vindo de Windows).
2. Define PATH explícito (cron não carrega o perfil), umask 0077, cria backups/ com chmod 0700, e pega um flock em backups/.backup-diario.lock.
3. Resolve COMPOSE_PROJECT_NAME via scripts/compose-project-name.sh e acha o container do serviço `db` com `docker compose ps -q db`.
4. Lê POSTGRES_USER/POSTGRES_DB do próprio container (`docker exec printenv`), com fallback bwaproj/bwaproj_db.
5. `docker exec <ctr> pg_dump -Fc --no-owner --no-acl | gzip -c > <arquivo>.parcial` — escreve em .parcial e só renomeia no fim.
6. Valida: tamanho >= BACKUP_MIN_BYTES (50 KiB) e >= 70% do backup anterior. Se reprovar, renomeia para .suspeito, escreve em stderr (o cron manda e-mail) e sai com código 3 — e NÃO apaga backups antigos.
7. Se aprovar, renomeia para o nome definitivo com chmod 0600 e só então aplica retenção (`find -mtime +14`), restrita ao glob próprio `bwa_tech_diario_????????_??????.dump.gz*`.
8. Sob cron fica silencioso; só imprime em stdout/stderr quando algo falha. Histórico completo em backups/backup-diario.log (podado em 5000 linhas).

### Restore / trazer produção para a máquina de dev

1. Na VPS, restore a partir de um backup: `./scripts/restore-prod-docker.sh backups/bwa_tech_diario_AAAAMMDD_HHMMSS.dump.gz` — para backend+celery, copia para /tmp do container db, `pg_restore --clean --if-exists`, sobe tudo de volta (trap EXIT remove o dump temporário).
2. Dump avulso antes de deploy com migrations: `./scripts/dump-prod-postgres.sh` (o diário das 3h pode estar a 24h de distância).
3. Do Windows: `$env:BWA_VPS_HOST='<IP>'; .\scripts\fetch-prod-dump.ps1` — roda o dump na VPS por SSH, pega o arquivo mais recente com `ls -t` e traz por scp para backend/dump_banco_prod/.
4. Restaurar no local: `.\scripts\restore-dump-banco-prod.ps1` (escolhe o mais recente) que delega para restore-local-docker.ps1, que descompacta o .gz num container alpine descartável e roda pg_restore no serviço `db` do compose local.
5. `.\scripts\fetch-prod-dump.ps1 -Restore` faz as duas etapas de uma vez.

---
