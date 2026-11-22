#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# Café Companion: VibeCraft & CounterFlow — Google Cloud Run Deployment Pipeline
# ============================================================================
export PROJECT_ID="cafe-companion-prod"
export REGION="asia-south1"
export REPO_NAME="cafe-companion-repo"
export SERVICE_NAME="cafe-companion-api"
export CLOUDSQL_INSTANCE="${PROJECT_ID}:${REGION}:cafe-companion-pg16"
export IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:$(git rev-parse --short HEAD 2>/dev/null || echo latest)"

# 1. Enable Required Google Cloud APIs
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  --project="${PROJECT_ID}"

# 2. Provision Artifact Registry Docker Repository (idempotent)
gcloud artifacts repositories describe "${REPO_NAME}" \
  --location="${REGION}" \
  --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud artifacts repositories create "${REPO_NAME}" \
  --repository-format=docker \
  --location="${REGION}" \
  --description="Café Companion container images" \
  --project="${PROJECT_ID}"

# 3. Build & Push Container Image via Cloud Build
gcloud builds submit \
  --tag="${IMAGE_URI}" \
  --project="${PROJECT_ID}" \
  .

# 4. Zero-Downtime Cloud Run Deployment with WebSocket Session Affinity & Cloud SQL Socket
gcloud run deploy "${SERVICE_NAME}" \
  --image="${IMAGE_URI}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --platform=managed \
  --allow-unauthenticated \
  --session-affinity \
  --timeout=3600 \
  --concurrency=250 \
  --cpu=2 \
  --memory=1Gi \
  --min-instances=1 \
  --max-instances=20 \
  --cpu-boost \
  --add-cloudsql-instances="${CLOUDSQL_INSTANCE}" \
  --set-env-vars="GEMINI_MODEL=gemini-4-hydrogen,EMBEDDING_MODEL=gemini-embedding-2" \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest,CLOUD_SQL_DSN=cloudsql-dsn:latest"
