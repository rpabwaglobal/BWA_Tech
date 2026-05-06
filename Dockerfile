# Multi-stage: 1) build frontend  2) backend + Daphne (serve API, WebSocket e SPA)
# Build do frontend (Vite/React)
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ ./
# Kanban em prod exige VITE_FORMULARIOS_API_BASE (API portal); ver frontend/.env.production.example
ARG VITE_API_URL=
ARG VITE_WS_URL=
ARG VITE_FORMULARIOS_API_BASE=
ARG VITE_FORMULARIOS_TOKEN_FROM_PORTAL=true
ARG VITE_FORMULARIOS_USE_PROXY=false
ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_FORMULARIOS_API_BASE=$VITE_FORMULARIOS_API_BASE \
    VITE_FORMULARIOS_TOKEN_FROM_PORTAL=$VITE_FORMULARIOS_TOKEN_FROM_PORTAL \
    VITE_FORMULARIOS_USE_PROXY=$VITE_FORMULARIOS_USE_PROXY
RUN npx vite build

# Backend (Django + Daphne)
FROM python:3.12-slim
WORKDIR /app/backend

# Dependências do sistema (PostgreSQL client, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
# SPA buildada: Django serve em /app/frontend/dist (serve_spa)
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Migrations + Daphne (HTTP + WebSocket). Cria pasta de mídia (fotos de perfil) no volume.
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["sh", "-c", "mkdir -p media/profiles && python manage.py migrate --noinput && python manage.py collectstatic --noinput && daphne -b 0.0.0.0 -p 8000 config.asgi:application"]
