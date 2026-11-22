# syntax=docker/dockerfile:1.7

# Stage 1: Build Vite + React PWA static bundle
FROM node:22-slim AS frontend-builder
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts firestore.rules Dockerfile ./
COPY infra ./infra
COPY backend ./backend
COPY public ./public
COPY src ./src
RUN npm run build

# Stage 2: Build Python dependency wheels
FROM python:3.12-slim AS python-builder
WORKDIR /wheels
COPY backend/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip wheel --no-cache-dir --wheel-dir /wheels/dist -r requirements.txt

# Stage 3: Minimal non-root Cloud Run runtime
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_ENV=production \
    USE_LOCAL_STORE=false \
    ENABLE_WEBSOCKETS=false \
    PORT=8080

RUN groupadd --gid 10001 appgroup \
    && useradd --uid 10001 --gid appgroup --shell /sbin/nologin --create-home appuser

WORKDIR /app
COPY --from=python-builder /wheels/dist /tmp/wheels
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir --no-index --find-links=/tmp/wheels -r ./backend/requirements.txt \
    && rm -rf /tmp/wheels

COPY backend ./backend
COPY --from=frontend-builder /build/dist ./dist

RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 8080
CMD ["sh", "-c", "uvicorn app.main:app --app-dir /app/backend --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]
