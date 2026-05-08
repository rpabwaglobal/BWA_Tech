# Multi-stage: 1) build frontend (Vite lê .env copiado da raiz como .env.production)
#              2) backend + /app/backend/.env dentro da imagem (Django load_dotenv)
# O ficheiro .env na raiz do repositório tem de existir no contexto do build (docker compose build).

FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ ./
COPY .env ./.env.production
RUN npx vite build

FROM python:3.12-slim
WORKDIR /app/backend

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY .env /app/backend/.env
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["sh", "-c", "mkdir -p media/profiles && python manage.py migrate --noinput && python manage.py collectstatic --noinput && daphne -b 0.0.0.0 -p 8000 config.asgi:application"]
