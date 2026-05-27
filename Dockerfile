# Multi-stage:
#  1) build frontend (Vite). Variáveis VITE_* devem ser passadas via --build-arg
#     ou definidas em .env.production fornecido como secret BuildKit no build.
#  2) backend Python rodando como usuário NÃO-root.
# .env NÃO é copiado para a imagem — o Compose injeta variáveis via env_file em runtime.

FROM node:20.18.1-alpine AS frontend-builder
# Build stage é descartado (só dist/ vai pra imagem final). USER não-root aqui
# só introduzia bug de permissão de diretório sem ganho de segurança real.
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ ./
# .env.production é opcional e deve ser fornecido como BuildKit secret:
#   docker buildx build --secret id=frontend_env,src=.env.production ...
# Aqui apenas fazemos o build; se VITE_* faltar, Vite usa fallback do código.
RUN npx vite build


FROM python:3.12.7-slim-bookworm
WORKDIR /app/backend

# Usuário não-root (UID/GID 10001) e dependências do sistema.
# WeasyPrint requer libpango, libcairo, libgdk-pixbuf, libffi e fonts-liberation
# (PDF não embed fontes do sistema sem isso e os relatórios saem com a fonte
# default feia). Fonts-noto-color-emoji é opcional para emojis no PDF.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        curl \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        libcairo2 \
        libgdk-pixbuf-2.0-0 \
        libffi8 \
        shared-mime-info \
        fonts-liberation \
        fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -g 10001 appuser \
    && useradd -u 10001 -g appuser -r -s /sbin/nologin -d /app/backend appuser

COPY --chown=appuser:appuser backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=appuser:appuser backend/ ./
COPY --chown=appuser:appuser --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Diretórios writáveis pelo usuário não-root.
RUN mkdir -p /app/backend/media/profiles /app/backend/staticfiles \
    && chown -R appuser:appuser /app/backend/media /app/backend/staticfiles

ENV PYTHONUNBUFFERED=1 \
    DOTENV_OVERRIDE=false

USER appuser:appuser
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/ || exit 1

# Migrations rodam no entrypoint apenas em dev/staging; em produção use job dedicado.
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py collectstatic --noinput && daphne -b 0.0.0.0 -p 8000 config.asgi:application"]
