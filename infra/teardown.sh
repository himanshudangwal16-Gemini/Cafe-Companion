#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Café Companion — Phase 6 Clean Teardown Script
# Removes Cloud Run service, alert policies, Artifact Registry repo, uploads
# bucket, Secret Manager secret, and dedicated service accounts.
# Firestore database deletion is OPT-IN (--delete-firestore) to protect data.
# ==============================================================================

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "ERROR: Export PROJECT_ID=<your-gcp-project-id> before running infra/teardown.sh" >&2
  exit 1
fi

REGION="${REGION:-asia-south1}"
SERVICE_NAME="${SERVICE_NAME:-cafe-companion-api}"
REPO_NAME="${REPO_NAME:-cafe-companion-repo}"
RUNTIME_SA_EMAIL="${RUNTIME_SA_EMAIL:-cafe-api-sa@${PROJECT_ID}.iam.gserviceaccount.com}"
BUILD_SA_EMAIL="${BUILD_SA_EMAIL:-cafe-build-sa@${PROJECT_ID}.iam.gserviceaccount.com}"
UPLOADS_BUCKET="${UPLOADS_BUCKET:-${PROJECT_ID}-cafe-uploads}"
GEMINI_SECRET_NAME="${GEMINI_SECRET_NAME:-gemini-api-key}"
FIRESTORE_DB="${FIRESTORE_DB:-(default)}"
DELETE_FIRESTORE="false"

for arg in "$@"; do
  if [[ "${arg}" == "--delete-firestore" ]]; then
    DELETE_FIRESTORE="true"
  fi
done

echo "WARNING: This will permanently delete Cafe Companion GCP resources in project '${PROJECT_ID}' (${REGION}):"
echo "  - Cloud Run service          : ${SERVICE_NAME}"
echo "  - Cloud Monitoring policies  : Cafe Companion — *"
echo "  - Artifact Registry repo     : ${REPO_NAME}"
echo "  - Cloud Storage bucket       : gs://${UPLOADS_BUCKET}"
echo "  - Secret Manager secret      : ${GEMINI_SECRET_NAME}"
echo "  - Service accounts           : ${RUNTIME_SA_EMAIL}, ${BUILD_SA_EMAIL}"
if [[ "${DELETE_FIRESTORE}" == "true" ]]; then
  echo "  - Cloud Firestore database   : ${FIRESTORE_DB} (ALL DOCUMENTS DELETED)"
else
  echo "  - Cloud Firestore database   : PRESERVED (pass --delete-firestore to also delete)"
fi

if [[ "${CONFIRM_TEARDOWN:-}" != "DELETE_ALL" ]]; then
  read -r -p "Type DELETE to confirm teardown: " REPLY
  if [[ "${REPLY}" != "DELETE" ]]; then
    echo "Teardown cancelled."
    exit 0
  fi
fi

echo "==> Deleting Cloud Run service '${SERVICE_NAME}'..."
gcloud run services delete "${SERVICE_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --quiet 2>/dev/null || echo "    Cloud Run service already absent."

echo "==> Deleting Cloud Monitoring alert policies..."
for policy_name in $(gcloud monitoring policies list \
  --project="${PROJECT_ID}" \
  --filter="displayName:'Cafe Companion'" \
  --format="value(name)" 2>/dev/null || true); do
  gcloud monitoring policies delete "${policy_name}" --project="${PROJECT_ID}" --quiet || true
done

echo "==> Deleting Artifact Registry repository '${REPO_NAME}'..."
gcloud artifacts repositories delete "${REPO_NAME}" \
  --location="${REGION}" \
  --project="${PROJECT_ID}" \
  --quiet 2>/dev/null || echo "    Artifact Registry repo already absent."

echo "==> Deleting temporary uploads bucket 'gs://${UPLOADS_BUCKET}'..."
gcloud storage rm --recursive "gs://${UPLOADS_BUCKET}" 2>/dev/null || echo "    Uploads bucket already absent."

echo "==> Deleting Secret Manager secret '${GEMINI_SECRET_NAME}'..."
gcloud secrets delete "${GEMINI_SECRET_NAME}" \
  --project="${PROJECT_ID}" \
  --quiet 2>/dev/null || echo "    Secret already absent."

echo "==> Deleting dedicated service accounts..."
gcloud iam service-accounts delete "${RUNTIME_SA_EMAIL}" --project="${PROJECT_ID}" --quiet 2>/dev/null || true
gcloud iam service-accounts delete "${BUILD_SA_EMAIL}" --project="${PROJECT_ID}" --quiet 2>/dev/null || true

if [[ "${DELETE_FIRESTORE}" == "true" ]]; then
  echo "==> Deleting Cloud Firestore database '${FIRESTORE_DB}'..."
  gcloud firestore databases delete \
    --database="${FIRESTORE_DB}" \
    --project="${PROJECT_ID}" \
    --quiet 2>/dev/null || echo "    Firestore database already absent."
fi

echo ""
echo "Teardown complete for project ${PROJECT_ID}. Billing budget alert was intentionally kept active."
