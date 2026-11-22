#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Café Companion: VibeCraft & CounterFlow — Phase 2 Idempotent GCP Bootstrap
# Target: Cloud Run + Firestore Native (Vector Search + TTL) under $5/month cap
# Default Region: asia-south1 (Mumbai, Tier 1 Cloud Run & Firestore Native)
# ==============================================================================

# Load required PROJECT_ID from environment or active gcloud config
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "ERROR: Export PROJECT_ID=<your-gcp-project-id> before running infra/setup.sh" >&2
  exit 1
fi

# Define regional and resource constants
REGION="${REGION:-asia-south1}"
FIRESTORE_DB="${FIRESTORE_DB:-(default)}"
REPO_NAME="${REPO_NAME:-cafe-companion-repo}"
RUNTIME_SA_NAME="${RUNTIME_SA_NAME:-cafe-api-sa}"
BUILD_SA_NAME="${BUILD_SA_NAME:-cafe-build-sa}"
RUNTIME_SA_EMAIL="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
BUILD_SA_EMAIL="${BUILD_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
UPLOADS_BUCKET="${UPLOADS_BUCKET:-${PROJECT_ID}-cafe-uploads}"
GEMINI_SECRET_NAME="${GEMINI_SECRET_NAME:-gemini-api-key}"
BUDGET_AMOUNT_USD="${BUDGET_AMOUNT_USD:-5USD}"

# Resolve linked Billing Account ID automatically if not supplied via env
BILLING_ACCOUNT_ID="${BILLING_ACCOUNT_ID:-$(gcloud billing projects describe "${PROJECT_ID}" --format='value(billingAccountName)' 2>/dev/null | sed 's|billingAccounts/||' || true)}"

# Set the active gcloud project
gcloud config set project "${PROJECT_ID}"

# Set default Cloud Run region to asia-south1
gcloud config set run/region "${REGION}"

# Enable all required Google Cloud APIs in a single idempotent call
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  billingbudgets.googleapis.com \
  identitytoolkit.googleapis.com \
  --project="${PROJECT_ID}"

# Create dedicated least-privilege runtime service account for Cloud Run (idempotent)
gcloud iam service-accounts describe "${RUNTIME_SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud iam service-accounts create "${RUNTIME_SA_NAME}" \
  --display-name="Cafe Companion Cloud Run API Runtime SA" \
  --project="${PROJECT_ID}"

# Create dedicated least-privilege CI/CD build service account for Cloud Build (idempotent)
gcloud iam service-accounts describe "${BUILD_SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud iam service-accounts create "${BUILD_SA_NAME}" \
  --display-name="Cafe Companion Cloud Build Deployer SA" \
  --project="${PROJECT_ID}"

# Grant runtime SA read/write access to Cloud Firestore
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/datastore.user" \
  --condition=None

# Grant runtime SA permission to write structured application logs to Cloud Logging
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/logging.logWriter" \
  --condition=None

# Grant runtime SA permission to emit custom operational metrics to Cloud Monitoring
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/monitoring.metricWriter" \
  --condition=None

# Grant Cloud Build SA permission to push images to Artifact Registry
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" \
  --role="roles/artifactregistry.writer" \
  --condition=None

# Grant Cloud Build SA permission to deploy Cloud Run revisions
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" \
  --role="roles/run.developer" \
  --condition=None

# Grant Cloud Build SA permission to write build logs
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" \
  --role="roles/logging.logWriter" \
  --condition=None

# Allow Cloud Build SA to attach only the runtime SA (never default compute SA)
gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA_EMAIL}" \
  --member="serviceAccount:${BUILD_SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser" \
  --project="${PROJECT_ID}"

# Create regional Cloud Storage bucket for temporary multimodal receipt/bean scans (idempotent)
gcloud storage buckets describe "gs://${UPLOADS_BUCKET}" --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud storage buckets create "gs://${UPLOADS_BUCKET}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --default-storage-class="STANDARD" \
  --uniform-bucket-level-access \
  --public-access-prevention

# Attach 7-day auto-deletion lifecycle rule to keep uploads bucket inside free/minimal storage
LIFECYCLE_FILE="$(mktemp)"
cat <<'EOF' > "${LIFECYCLE_FILE}"
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": { "age": 7 }
    }
  ]
}
EOF
gcloud storage buckets update "gs://${UPLOADS_BUCKET}" --lifecycle-file="${LIFECYCLE_FILE}" --project="${PROJECT_ID}"
rm -f "${LIFECYCLE_FILE}"

# Grant runtime SA object read/write strictly on the uploads bucket
gcloud storage buckets add-iam-policy-binding "gs://${UPLOADS_BUCKET}" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/storage.objectUser"

# Create Cloud Firestore Native database in asia-south1 (idempotent)
gcloud firestore databases describe --database="${FIRESTORE_DB}" --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud firestore databases create \
  --database="${FIRESTORE_DB}" \
  --location="${REGION}" \
  --type="firestore-native" \
  --project="${PROJECT_ID}"

# Enable Firestore TTL auto-purge policy on community_vibes.expires_at for 2-hour ephemeral sessions
gcloud firestore fields ttls update expires_at \
  --collection-group="community_vibes" \
  --database="${FIRESTORE_DB}" \
  --enable-ttl \
  --project="${PROJECT_ID}" \
  --async

# Create Firestore Vector Search index (768-dim flat COSINE) on community_vibes.embedding (ignore if exists)
gcloud firestore indexes composite create \
  --database="${FIRESTORE_DB}" \
  --collection-group="community_vibes" \
  --query-scope="COLLECTION" \
  --field-config='field-path=embedding,vector-config={"dimension":"768","flat":"{}"}' \
  --project="${PROJECT_ID}" 2>/dev/null || echo "Vector index (embedding) already exists or is building."

# Create composite Vector Search index supporting pre-filtered open_to_connect KNN queries (ignore if exists)
gcloud firestore indexes composite create \
  --database="${FIRESTORE_DB}" \
  --collection-group="community_vibes" \
  --query-scope="COLLECTION" \
  --field-config="field-path=open_to_connect,order=ascending" \
  --field-config='field-path=embedding,vector-config={"dimension":"768","flat":"{}"}' \
  --project="${PROJECT_ID}" 2>/dev/null || echo "Filtered vector index (open_to_connect + embedding) already exists or is building."

# Create composite index for active KDS order queue ordered by newest first (ignore if exists)
gcloud firestore indexes composite create \
  --database="${FIRESTORE_DB}" \
  --collection-group="orders" \
  --query-scope="COLLECTION" \
  --field-config="field-path=status,order=ascending" \
  --field-config="field-path=created_at,order=descending" \
  --project="${PROJECT_ID}" 2>/dev/null || echo "Orders composite index already exists or is building."

# Create composite index for available menu inventory grouped by category (ignore if exists)
gcloud firestore indexes composite create \
  --database="${FIRESTORE_DB}" \
  --collection-group="menu_items" \
  --query-scope="COLLECTION" \
  --field-config="field-path=is_available,order=ascending" \
  --field-config="field-path=category,order=ascending" \
  --project="${PROJECT_ID}" 2>/dev/null || echo "Menu composite index already exists or is building."

# Create composite index for unresolved ambient operations alerts (ignore if exists)
gcloud firestore indexes composite create \
  --database="${FIRESTORE_DB}" \
  --collection-group="ambient_telemetry_logs" \
  --query-scope="COLLECTION" \
  --field-config="field-path=resolved,order=ascending" \
  --field-config="field-path=created_at,order=descending" \
  --project="${PROJECT_ID}" 2>/dev/null || echo "Ambient logs composite index already exists or is building."

# Create Secret Manager container for GEMINI_API_KEY (idempotent, never stores key in script)
gcloud secrets describe "${GEMINI_SECRET_NAME}" --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud secrets create "${GEMINI_SECRET_NAME}" \
  --replication-policy="user-managed" \
  --locations="${REGION}" \
  --project="${PROJECT_ID}"

# Add initial secret version only if GEMINI_API_KEY env var is explicitly provided at runtime
if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  printf '%s' "${GEMINI_API_KEY}" | gcloud secrets versions add "${GEMINI_SECRET_NAME}" \
    --data-file=- \
    --project="${PROJECT_ID}"
else
  echo "NOTE: Run 'printf \"%s\" \"<KEY>\" | gcloud secrets versions add ${GEMINI_SECRET_NAME} --data-file=- --project=${PROJECT_ID}' to populate the secret."
fi

# Grant runtime SA Secret Accessor strictly on gemini-api-key (least privilege, not project-wide)
gcloud secrets add-iam-policy-binding "${GEMINI_SECRET_NAME}" \
  --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" \
  --project="${PROJECT_ID}"

# Create regional Artifact Registry Docker repository in asia-south1 (idempotent)
gcloud artifacts repositories describe "${REPO_NAME}" --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1 || \
gcloud artifacts repositories create "${REPO_NAME}" \
  --repository-format="docker" \
  --location="${REGION}" \
  --description="Cafe Companion container images" \
  --project="${PROJECT_ID}"

# Configure Artifact Registry cleanup policy to keep only the 3 newest versions (stays inside 0.5 GB free tier)
AR_POLICY_FILE="$(mktemp)"
cat <<'EOF' > "${AR_POLICY_FILE}"
[
  {
    "name": "keep-latest-3",
    "action": { "type": "Keep" },
    "mostRecentVersions": { "keepCount": 3 }
  }
]
EOF
gcloud artifacts repositories set-cleanup-policies "${REPO_NAME}" \
  --location="${REGION}" \
  --policy="${AR_POLICY_FILE}" \
  --project="${PROJECT_ID}"
rm -f "${AR_POLICY_FILE}"

# Provision $5.00 USD monthly Cloud Billing budget with 50%, 90%, and 100% alert thresholds (idempotent)
if [[ -n "${BILLING_ACCOUNT_ID}" ]]; then
  EXISTING_BUDGET="$(gcloud billing budgets list --billing-account="${BILLING_ACCOUNT_ID}" --filter="displayName='Cafe Companion $5 Monthly Cap (${PROJECT_ID})'" --format='value(name)' 2>/dev/null || true)"
  if [[ -z "${EXISTING_BUDGET}" ]]; then
    PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
    gcloud billing budgets create \
      --billing-account="${BILLING_ACCOUNT_ID}" \
      --display-name="Cafe Companion \$5 Monthly Cap (${PROJECT_ID})" \
      --budget-amount="${BUDGET_AMOUNT_USD}" \
      --filter-projects="projects/${PROJECT_NUMBER}" \
      --threshold-rule=percent=0.5,basis=current-spend \
      --threshold-rule=percent=0.9,basis=current-spend \
      --threshold-rule=percent=1.0,basis=current-spend \
      --threshold-rule=percent=1.0,basis=forecasted-spend
  else
    echo "Budget alert already configured: ${EXISTING_BUDGET}"
  fi
else
  echo "WARNING: No linked billing account detected. Set BILLING_ACCOUNT_ID and re-run to create the $5 budget alert."
fi

echo "Phase 2 infrastructure bootstrap complete for project ${PROJECT_ID} in ${REGION}."
