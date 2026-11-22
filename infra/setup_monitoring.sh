#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Café Companion — Phase 6 Observability & Alerting Provisioner
# Creates an email notification channel (Beta CLI track) and attaches GA Cloud
# Monitoring alert policies for 5xx error bursts and p95 latency > 3s.
# ==============================================================================

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "ERROR: Export PROJECT_ID=<your-gcp-project-id> before running infra/setup_monitoring.sh" >&2
  exit 1
fi

ALERT_EMAIL="${ALERT_EMAIL:-}"
CHANNEL_NAME=""

if [[ -n "${ALERT_EMAIL}" ]]; then
  echo "==> Checking for existing email notification channel for ${ALERT_EMAIL}..."
  CHANNEL_NAME="$(gcloud beta monitoring channels list \
    --project="${PROJECT_ID}" \
    --filter="type='email' AND labels.email_address='${ALERT_EMAIL}'" \
    --format="value(name)" | head -n 1 || true)"

  if [[ -z "${CHANNEL_NAME}" ]]; then
    echo "==> Creating email notification channel (uses gcloud beta track)..."
    CHANNEL_NAME="$(gcloud beta monitoring channels create \
      --project="${PROJECT_ID}" \
      --display-name="Cafe Companion Ops Email" \
      --description="Alerts for Cafe Companion Cloud Run errors and latency" \
      --type="email" \
      --channel-labels="email_address=${ALERT_EMAIL}" \
      --format="value(name)")"
  fi
  echo "    Notification channel: ${CHANNEL_NAME}"
else
  echo "NOTE: ALERT_EMAIL not set; alert policies will be created without an email channel attached."
fi

create_or_skip_policy() {
  local display_name="$1"
  local policy_file="$2"
  local existing
  existing="$(gcloud monitoring policies list \
    --project="${PROJECT_ID}" \
    --filter="displayName='${display_name}'" \
    --format="value(name)" | head -n 1 || true)"

  if [[ -n "${existing}" ]]; then
    echo "==> Alert policy already exists: ${display_name} (${existing})"
    return
  fi

  echo "==> Creating Cloud Monitoring alert policy: ${display_name}..."
  if [[ -n "${CHANNEL_NAME}" ]]; then
    gcloud monitoring policies create \
      --project="${PROJECT_ID}" \
      --policy-from-file="${policy_file}" \
      --notification-channels="${CHANNEL_NAME}"
  else
    gcloud monitoring policies create \
      --project="${PROJECT_ID}" \
      --policy-from-file="${policy_file}"
  fi
}

create_or_skip_policy "Cafe Companion — Cloud Run 5xx Error Burst" "infra/alerts/cloud-run-5xx-alert.json"
create_or_skip_policy "Cafe Companion — Cloud Run High p95 Latency (> 3s)" "infra/alerts/cloud-run-latency-alert.json"

echo ""
echo "Observability setup complete. Useful Cloud Logging queries:"
echo "  # Recent application errors"
echo "  gcloud logging read 'resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"cafe-companion-api\" AND severity>=ERROR' --project=${PROJECT_ID} --limit=25"
echo "  # CounterFlow fallback or warning events"
echo "  gcloud logging read 'resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"cafe-companion-api\" AND severity>=WARNING' --project=${PROJECT_ID} --limit=25"
