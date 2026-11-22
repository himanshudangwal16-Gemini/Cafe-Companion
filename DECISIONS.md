# Architecture & Engineering Decisions (`DECISIONS.md`)

This log tracks all architectural decisions, cost trade-offs, and security guardrails for **Café Companion: VibeCraft & CounterFlow**.

---

## ADR-001: Cloud Firestore Native + Vector Search Over Cloud SQL
- **Status**: Accepted (Phase 1 / Phase 2)
- **Decision**: Replace Cloud SQL (PostgreSQL + `pgvector`) with **Cloud Firestore in Native mode** (`asia-south1`) using native **Firestore Vector Search** (`dimension=768`, `flat`/`COSINE`).
- **Rationale**: Cloud SQL instances incur continuous hourly compute/storage charges (~$15–$50/month) even when lightly loaded, violating the hard **$5/month** budget cap. Firestore Native provides an Always Free tier (1 GiB storage, 50,000 reads/day, 20,000 writes/day) and includes Vector Search and TTL policies with zero hourly cluster fees.
- **Trade-Off**: Relational joins and SQL triggers are replaced with denormalized document structures (embedding `items[]` and `stage_history[]` inside `orders`), transactional inventory decrements, and client-side Firestore real-time listeners.

## ADR-002: Firestore Real-Time Listeners (`onSnapshot`) Over Persistent Cloud Run WebSockets
- **Status**: Proposed & Recommended (Phase 1)
- **Decision**: Use Firestore `onSnapshot` listeners directly from the PWA and Barista KDS for real-time order status, live countdown calculation (from authoritative `estimated_ready_at` timestamp), post-completion feedback, and ambient KDS alerts. Cloud Run FastAPI handles short-lived HTTP mutations and Gemini API inference only (`min-instances=0`).
- **Rationale**: On Cloud Run request-based billing, holding open WebSockets for 12 hours/day across KDS tablets and patron phones bills continuous vCPU/memory seconds (~$22–$30/month), exceeding the $5/month cap. Offloading real-time fan-out to Firestore keeps Cloud Run well inside its Always Free tier (180,000 vCPU-sec/month = `$0.00`).
- **Trade-Off**: Sub-second countdown ticks are computed on the client against the server-written `estimated_ready_at` timestamp rather than streamed every second from a container loop, eliminating idle container billing while preserving identical UX.

## ADR-003: Strict 2-Hour Ephemeral Privacy for Table Connect (TTL + Query Filter)
- **Status**: Accepted (Phase 2)
- **Decision**: Enable Firestore TTL on `community_vibes.expires_at` (`gcloud firestore fields ttls update`) **and** enforce an application-level `expires_at > now` filter on all matching responses.
- **Rationale**: Firestore TTL policies delete expired documents asynchronously (typically within 24 hours) at no scheduler cost. Combining TTL with a strict read-time check guarantees patrons immediately disappear after 2 hours while preventing unbounded storage growth.

## ADR-004: Active Gemini Models Over Deprecated Model IDs
- **Status**: Accepted (Phase 1)
- **Decision**: Use the current active Flash-class model (`gemini-4-hydrogen`) and `gemini-embedding-2` (`output_dimensionality=768`) via the `google-genai` SDK instead of deprecated `gemini-2.0-flash` / `text-embedding-004`.
- **Rationale**: Avoids `404 NOT_FOUND` API deprecation failures while maintaining `< 1.5s` low-latency structured JSON (`response_schema`) generation and 768-dimension vector compatibility with the Firestore vector index.

## ADR-005: Least-Privilege Service Accounts & Resource-Scoped IAM
- **Status**: Accepted (Phase 2)
- **Decision**: Provision two dedicated service accounts (`cafe-api-sa` for Cloud Run runtime and `cafe-build-sa` for Cloud Build CI/CD). Never use the default Compute Engine SA or `roles/owner`. Scope `roles/secretmanager.secretAccessor` strictly to the `gemini-api-key` secret resource and `roles/storage.objectUser` strictly to the regional uploads bucket.
- **Rationale**: Minimizes blast radius in case of container or pipeline compromise and adheres to GCP security best practices.

## ADR-006: Storage & Artifact Registry Free-Tier Guardrails
- **Status**: Accepted (Phase 2)
- **Decision**: Apply an Artifact Registry cleanup policy retaining only the 3 most recent container image versions (`keep-latest-3`), and a 7-day Cloud Storage object lifecycle delete rule on temporary receipt/allergen scan uploads.
- **Rationale**: Prevents image buildup from crossing the 0.5 GB Artifact Registry free tier or accumulating forgotten multimodal upload blobs.

## ADR-007: Protocol-Backed Firestore Native Repository With In-Memory Local Parity
- **Status**: Accepted (Phase 3)
- **Decision**: Abstract all persistence behind a typed `CafeRepository` protocol with two implementations: `FirestoreNativeRepo` (production `google-cloud-firestore` async client with native `find_nearest` COSINE vector search and transactions) and `InMemoryFirestoreRepo` (`USE_LOCAL_STORE=true`) for zero-credential local development and deterministic pytest execution.
- **Rationale**: Allows developers and CI pipelines to verify all 5 user flows, stock transactions, 2-hour TTL expiry filtering, and cosine similarity matching locally at `$0.00` without provisioning extra emulators or exposing production data.

## ADR-008: Defense-in-Depth Prompt-Injection Fencing & Human Order Confirmation
- **Status**: Accepted (Phase 3)
- **Decision**: Sanitize all free-text fields via `sanitizer.py`, wrap user and retrieved content inside `<untrusted_*>` XML delimiters in every Gemini prompt, refuse detected override attempts with safe menu-catalog fallbacks, strictly reconcile Gemini SKU outputs against live in-stock inventory, and require `confirmed_by_human=True` before creating an order ticket.
- **Rationale**: Prevents prompt injection from fabricating SKUs, overriding prices, or leaking configuration, and ensures AI recommendations never execute an order without explicit patron/cashier approval.

## ADR-009: Dual-Mode Deterministic + Live Gemini Evaluation Suite (18 Cases)
- **Status**: Accepted (Phase 4)
- **Decision**: Ship an 18-case JSON evaluation benchmark (`backend/tests/eval_dataset.json`) covering palate matching, out-of-stock reconciliation, 7 prompt-injection attacks (palate & ambient triage), CounterFlow wait-time monotonicity, control-character sanitization, and 768-dim cosine ranking. Run deterministically in CI at `$0.00` (`RUN_LIVE_GEMINI_EVAL=false`) while allowing live Gemini verification (`RUN_LIVE_GEMINI_EVAL=true`) before production releases.
- **Rationale**: Keeps continuous integration fast, reproducible, and free while exercising the exact same input sanitization, prompt-injection guards, Pydantic schemas, and SKU reconciliation paths used in production.

## ADR-010: Single-Service Cloud Run Deployment With Scale-to-Zero & Origin-Locked CORS
- **Status**: Accepted (Phase 5)
- **Decision**: Serve both the compiled Vite React PWA (`dist/`) and the FastAPI REST API from a single Cloud Run service (`cafe-companion-api`) in `asia-south1` with `--min-instances=0`, `--max-instances=3`, `--cpu=1`, `--memory=512Mi`, `--timeout=60`, `--service-account=cafe-api-sa`, Secret Manager injection (`GEMINI_API_KEY=gemini-api-key:latest`), and automatic `ALLOWED_ORIGINS=${SERVICE_URL}` lock-down.
- **Rationale**: Eliminates separate Firebase Hosting/CDN wiring and cross-origin cookie/header complexity while guaranteeing zero idle compute charges (`min-instances=0`) and capping burst spend (`max-instances=3`) well within the **$5/month** budget.

## ADR-011: Test-Gated Cloud Build CI/CD, Free-Tier Observability & Safe Teardown
- **Status**: Accepted (Phase 6)
- **Decision**: Gate every automated Cloud Build rollout (`cloudbuild.yaml`, running as `cafe-build-sa` with `CLOUD_LOGGING_ONLY`) behind the full `pytest` + 18-case Gemini/prompt-injection suite before building or deploying to Cloud Run. Provision Cloud Monitoring policies on built-in free Cloud Run metrics (`request_count` 5xx and `request_latencies` p95) rather than paid custom metrics. Require explicit human confirmation in `infra/teardown.sh` and keep Firestore database deletion opt-in (`--delete-firestore`).
- **Rationale**: Prevents broken API routes or regressed prompt-injection guards from ever reaching production, keeps observability at `$0.00/mo` within Cloud Logging/Monitoring free tiers, and protects customer/order records from accidental deletion during cleanup.

