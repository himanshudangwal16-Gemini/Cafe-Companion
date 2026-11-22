#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Café Companion: VibeCraft & CounterFlow — Phase 5 Production Deploy Script
# Builds container via Cloud Build, deploys firestore.rules, deploys Cloud Run
# in asia-south1 (scale-to-zero, max-instances=3, cafe-api-sa), and smoke tests.
# ==============================================================================

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "ERROR: Export PROJECT_ID=<your-gcp-project-id> before running infra/deploy.sh" >&2
  exit 1
fi

REGION="${REGION:-asia-south1}"
SERVICE_NAME="${SERVICE_NAME:-cafe-companion-api}"
REPO_NAME="${REPO_NAME:-cafe-companion-repo}"
IMAGE_NAME="${IMAGE_NAME:-cafe-companion}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date -u +%Y%m%d%H%M%S)}"
RUNTIME_SA_EMAIL="${RUNTIME_SA_EMAIL:-cafe-api-sa@${PROJECT_ID}.iam.gserviceaccount.com}"
BUILD_SA_EMAIL="${BUILD_SA_EMAIL:-cafe-build-sa@${PROJECT_ID}.iam.gserviceaccount.com}"
GEMINI_SECRET_NAME="${GEMINI_SECRET_NAME:-gemini-api-key}"
FIRESTORE_DB="${FIRESTORE_DB:-(default)}"
STAFF_ALLOWLIST_EMAILS="${STAFF_ALLOWLIST_EMAILS:-}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}"
SKIP_SEED="${SKIP_SEED:-false}"

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${IMAGE_NAME}:${IMAGE_TAG}"

echo "==> [1/5] Verifying Secret Manager secret '${GEMINI_SECRET_NAME}' has an enabled version..."
ENABLED_VERSIONS="$(gcloud secrets versions list "${GEMINI_SECRET_NAME}" \
  --project="${PROJECT_ID}" \
  --filter="state=ENABLED" \
  --format="value(name)" 2>/dev/null || true)"
if [[ -z "${ENABLED_VERSIONS}" ]]; then
  echo "ERROR: Secret '${GEMINI_SECRET_NAME}' has no enabled version. Add your Gemini API key first:" >&2
  echo "  printf '%s' 'YOUR_GEMINI_API_KEY' | gcloud secrets versions add ${GEMINI_SECRET_NAME} --data-file=- --project=${PROJECT_ID}" >&2
  exit 1
fi

echo "==> [2/5] Deploying hardened Firestore Native security rules (firestore.rules)..."
if command -v firebase >/dev/null 2>&1; then
  firebase deploy --only firestore:rules --project "${PROJECT_ID}" --non-interactive
else
  echo "NOTE: Firebase CLI not found in PATH. Deploy rules separately with:"
  echo "  npx firebase-tools deploy --only firestore:rules --project ${PROJECT_ID}"
fi

echo "==> [3/5] Building and pushing multi-stage container image to Artifact Registry (${REGION})..."
gcloud builds submit \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --service-account="projects/${PROJECT_ID}/serviceAccounts/${BUILD_SA_EMAIL}" \
  --default-buckets-behavior="regional-user-owned-bucket" \
  --tag="${IMAGE_URI}" \
  .

echo "==> [4/5] Deploying Cloud Run service '${SERVICE_NAME}' in ${REGION} (scale-to-zero, max-instances=3)..."
ENV_VARS="APP_ENV=production,USE_LOCAL_STORE=false,LOCAL_DEV_AUTH_BYPASS=false,ENABLE_WEBSOCKETS=false,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},FIRESTORE_DATABASE=${FIRESTORE_DB},GEMINI_MODEL=gemini-4-hydrogen,EMBEDDING_MODEL=gemini-embedding-2"
if [[ -n "${STAFF_ALLOWLIST_EMAILS}" ]]; then
  ENV_VARS="${ENV_VARS},STAFF_ALLOWLIST_EMAILS=${STAFF_ALLOWLIST_EMAILS}"
fi
if [[ -n "${ALLOWED_ORIGINS}" ]]; then
  ENV_VARS="${ENV_VARS},ALLOWED_ORIGINS=${ALLOWED_ORIGINS}"
fi

gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMAGE_URI}" \
  --service-account="${RUNTIME_SA_EMAIL}" \
  --cpu="1" \
  --memory="512Mi" \
  --concurrency="80" \
  --timeout="60" \
  --min-instances="0" \
  --max-instances="3" \
  --set-env-vars="${ENV_VARS}" \
  --set-secrets="GEMINI_API_KEY=${GEMINI_SECRET_NAME}:latest" \
  --allow-unauthenticated

SERVICE_URL="$(gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)")"

# Lock CORS strictly to the live Cloud Run HTTPS origin when custom origins were not supplied
if [[ -z "${ALLOWED_ORIGINS}" ]]; then
  echo "==> Locking ALLOWED_ORIGINS to live service origin: ${SERVICE_URL}"
  gcloud run services update "${SERVICE_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --update-env-vars="ALLOWED_ORIGINS=${SERVICE_URL}"
fi

if [[ "${SKIP_SEED}" != "true" ]] && command -v python3 >/dev/null 2>&1; then
  echo "==> Seeding Firestore Native menu_items and ambient_logs idempotently..."
  GOOGLE_CLOUD_PROJECT="${PROJECT_ID}" FIRESTORE_DATABASE="${FIRESTORE_DB}" \
    PYTHONPATH="backend" python3 backend/seed.py || \
    echo "NOTE: Local seed skipped (install backend/requirements.txt + run 'gcloud auth application-default login' to seed from CLI)."
fi

echo "==> [5/5] Running live post-deploy smoke verification against ${SERVICE_URL}..."
chmod +x infra/smoke_test.sh
SERVICE_URL="${SERVICE_URL}" ./infra/smoke_test.sh

echo ""
echo "=============================================================================="
echo "Deployment complete!"
echo "  Live PWA & API URL : ${SERVICE_URL}"
echo "  Health Endpoint    : ${SERVICE_URL}/health"
echo "  Menu Catalog API   : ${SERVICE_URL}/api/menu"
echo "  Image Deployed     : ${IMAGE_URI}"
echo "=============================================================================="
