# Café Companion: VibeCraft & CounterFlow

An AI-native specialty café experience platform unifying walk-in Counter POS handoff, real-time order timers, multimodal palate discovery, ephemeral Table Connect networking, Barista KDS operations, and post-completion quality feedback on **Google Cloud** under a strict **$5/month budget cap**.

## Architecture Overview

- **Region**: `asia-south1` (Mumbai — Tier 1 Cloud Run Always Free eligible, Firestore Native + Vector Search supported, zero cross-region egress).
- **Frontend**: Responsive Vite + React Progressive Web App (PWA) supporting zero-app QR/NFC launch and Firestore real-time `onSnapshot` subscriptions.
- **Backend**: Python 3.12 + FastAPI (`backend/app/main.py`) on **Google Cloud Run** (`min-instances=0`, scales to zero).
- **Database & Vector Search**: **Cloud Firestore (Native mode)** with 768-dim Cosine Vector Search (`community_vibes`) and TTL auto-purge (`expires_at`). **No Cloud SQL** is used.
- **AI Engine**: Google GenAI SDK (`google-genai`) using `gemini-4-hydrogen` (structured JSON via `response_schema`, multimodal vision) and `gemini-embedding-2` (`output_dimensionality=768`).
- **Security**: Dedicated least-privilege service accounts (`cafe-api-sa`, `cafe-build-sa`), Secret Manager resource-scoped IAM, Firebase Authentication, prompt-injection fencing (`<untrusted_*>` tags), and hardened `firestore.rules`.

## Monthly Cost Guardrail (< $5.00/mo)

| Service | Configuration | Estimated Cost |
| :--- | :--- | :--- |
| Cloud Run (`asia-south1`) | `min-instances=0`, 1 vCPU, 512 MiB, short HTTP calls | `$0.00` (Always Free) |
| Cloud Firestore Native + Vector Search + TTL | `asia-south1`, `onSnapshot` live push | `$0.00` (Always Free: 50k reads/day, 20k writes/day, 1 GiB) |
| Firebase Authentication | Google Sign-In + scoped QR handoff tokens | `$0.00` (Free up to 50k MAU) |
| Artifact Registry + Cloud Build | 3-image retention cleanup policy | `$0.00` (Always Free: 0.5 GB, 120 build-min/day) |
| Secret Manager + Cloud Storage | 1 secret version + 7-day upload auto-delete | `$0.00` (Always Free) |
| Gemini API (Flash + Embeddings) | Low-cost Flash model + 768-dim embeddings | `$0.50 – $2.00` |
| **Total** | **Budget alerts at 50%, 90%, 100%** | **`$0.50 – $2.00 / mo`** |

## Project Structure

```text
.
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── firestore_repo.py   # Cloud Firestore Native + Vector Search + local fallback
│   │   ├── gemini_service.py   # google-genai structured outputs, vision & 768-dim embeddings
│   │   ├── main.py             # FastAPI REST API, Firebase Auth, RBAC, optional local WS & SPA host
│   │   ├── models.py           # Strict Pydantic v2 API & Gemini response_schema models
│   │   └── sanitizer.py        # Input sanitization & prompt-injection detection/fencing
│   ├── requirements.txt
│   └── seed.py                 # Idempotent Firestore Native sample menu & ambient seeder
├── infra/
│   └── setup.sh                # Idempotent GCP bootstrap (Phase 2)
├── src/                        # Vite + React PWA frontend (Counter, Table Connect, KDS, Pulse, Architecture)
├── public/                     # PWA icons & manifest assets
├── firestore.rules             # Hardened Cloud Firestore Native security rules
├── Dockerfile                  # Multi-stage Vite + Python 3.12 non-root Cloud Run container
├── .dockerignore
├── DECISIONS.md                # Architecture Decision Records (ADR-001 – ADR-008)
└── README.md
```

## Phase 2 — Bootstrap Google Cloud Infrastructure

```bash
# 1. Authenticate and target your project
gcloud auth login
export PROJECT_ID="your-gcp-project-id"
export REGION="asia-south1"

# 2. Run idempotent infrastructure bootstrap
chmod +x infra/setup.sh
./infra/setup.sh

# 3. Populate the Gemini API key in Secret Manager (never commit keys to git)
printf "%s" "YOUR_GEMINI_API_KEY" | \
  gcloud secrets versions add gemini-api-key --data-file=- --project="${PROJECT_ID}"
```

## Phase 3 — Run Locally

### Option A: Zero-Credential Local Mode (In-Memory Firestore Emulator Parity)

```bash
# 1. Create Python virtual environment and install backend dependencies
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt

# 2. Build the React PWA bundle once (or run Vite dev server separately)
npm install
npm run build

# 3. Start FastAPI in local mode (auto-seeds 8 specialty menu items & 2 ambient logs)
export APP_ENV="local"
export USE_LOCAL_STORE="true"
export LOCAL_DEV_AUTH_BYPASS="true"
export GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8080 --reload
```

### Option B: Connected to Cloud Firestore Native (`asia-south1`)

```bash
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT="your-gcp-project-id"
export APP_ENV="local"
export USE_LOCAL_STORE="false"
export GEMINI_API_KEY="YOUR_GEMINI_API_KEY"

# Seed Firestore Native idempotently
python3 backend/seed.py

# Start FastAPI
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8080 --reload
```

### Option C: Local Docker Build Verification

```bash
docker build -t cafe-companion:local .
docker run --rm -p 8080:8080 \
  -e APP_ENV=local \
  -e USE_LOCAL_STORE=true \
  -e LOCAL_DEV_AUTH_BYPASS=true \
  -e GEMINI_API_KEY="${GEMINI_API_KEY}" \
  cafe-companion:local
```

### Walkthrough of the 5 Core User Flows

1. **Omnichannel QR/NFC Handoff & Dynamic Wait Time**: Register an order via `POST /api/orders` (`confirmed_by_human=true`), inspect the Gemini-predicted wait time and generated `handoff_token`, and fetch the zero-app ticket state via `GET /api/orders/handoff/{handoff_token}`.
2. **VibeCraft Multimodal Sommelier**: Send natural-language dietary/mood prompts or a base64 receipt/bean-bag photo to `POST /api/palate/match` and receive 2–3 SKUs strictly reconciled against live in-stock inventory.
3. **Table Connect (2h Ephemeral Vector Matching)**: Opt in via `POST /api/table-connect/opt-in` (`X-Dev-Uid: patron-1` locally or Firebase Bearer token) to generate a 768-dim `gemini-embedding-2` vector with a 2-hour `expires_at`, query cosine matches at `GET /api/table-connect/matches`, and craft an opener via `POST /api/table-connect/icebreaker`.
4. **Barista KDS & Ambient Operations Pulse**: Advance ticket stages (`PATCH /api/orders/{id}/stage` with barista role), submit comfort/acoustic telemetry (`POST /api/ambient/report`), review Gemini's shift-lead severity & action, and resolve alerts (`PATCH /api/ambient/{id}/resolve`).
5. **Post-Completion Quality Feedback Loop**: Once an order reaches `READY_PICKUP`, submit 1–5 drink quality and service ratings (`POST /api/orders/{id}/feedback` with the order's `handoff_token` or patron UID), inspect rolling averages on `GET /api/feedback`, and acknowledge via `PATCH /api/feedback/{id}/acknowledge`.

## Phase 4 — Automated Tests & 18-Case Gemini Evaluation

```bash
# 1. Run all API unit/integration tests + 18-case Gemini eval suite offline ($0.00)
PYTHONPATH=backend pytest -v backend/tests

# 2. Run the standalone 18-case Gemini eval scorecard (offline deterministic mode)
PYTHONPATH=backend python3 -m tests.test_gemini_eval

# 3. Run the same 18-case eval against live Gemini API (optional, uses GEMINI_API_KEY)
RUN_LIVE_GEMINI_EVAL=true GEMINI_API_KEY="YOUR_GEMINI_API_KEY" \
  PYTHONPATH=backend python3 -m tests.test_gemini_eval
```

## Phase 5 — Deploy to Google Cloud Run (`asia-south1`)

```bash
# 1. Target your GCP project and optional staff allowlist emails
export PROJECT_ID="your-gcp-project-id"
export REGION="asia-south1"
export STAFF_ALLOWLIST_EMAILS="barista@yourcafe.com"

# 2. Build container via Cloud Build, deploy firestore.rules, deploy Cloud Run, and run live smoke checks
chmod +x infra/deploy.sh infra/smoke_test.sh
./infra/deploy.sh
```

### Verify Live Deployment Independently

```bash
export SERVICE_URL="$(gcloud run services describe cafe-companion-api \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format='value(status.url)')"

./infra/smoke_test.sh
```

## Phase 6 — Operate: Monitoring, Logging, CI/CD & Clean Teardown

### 1. Provision Cloud Monitoring Alert Policies (5xx Burst & p95 Latency)
```bash
export PROJECT_ID="your-gcp-project-id"
export ALERT_EMAIL="ops@yourcafe.com"

chmod +x infra/setup_monitoring.sh
./infra/setup_monitoring.sh
```

### 2. Inspect Structured Cloud Logs
```bash
# Live error logs
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="cafe-companion-api" AND severity>=ERROR' \
  --project="${PROJECT_ID}" --limit=25

# Tail real-time revision logs
gcloud beta run services logs tail cafe-companion-api \
  --region="${REGION:-asia-south1}" --project="${PROJECT_ID}"
```

### 3. Run Test-Gated Cloud Build CI/CD (`cloudbuild.yaml`)
```bash
gcloud builds submit \
  --project="${PROJECT_ID}" \
  --region="${REGION:-asia-south1}" \
  --service-account="projects/${PROJECT_ID}/serviceAccounts/cafe-build-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --default-buckets-behavior="regional-user-owned-bucket" \
  --config="cloudbuild.yaml" \
  .
```

### 4. Clean Teardown (Preserves Firestore Data by Default)
```bash
chmod +x infra/teardown.sh

# Remove Cloud Run, alerts, Artifact Registry, uploads bucket, secret & service accounts
./infra/teardown.sh

# Optionally also wipe the Firestore (default) database
./infra/teardown.sh --delete-firestore
```
