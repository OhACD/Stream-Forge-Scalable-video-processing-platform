#!/bin/bash

# Apply baseline Cloud Monitoring alert policies for Stream Forge.
# Requires gcloud CLI and Monitoring API enabled.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
POLICY_DIR="$SCRIPT_DIR/monitoring"

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  echo "ERROR: GCP_PROJECT_ID not set"
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI is required but not installed"
  exit 1
fi

echo "Applying monitoring policies for project: $PROJECT_ID"

for policy in \
  "$POLICY_DIR/api-availability-policy.json" \
  "$POLICY_DIR/api-latency-p95-policy.json"; do
  if [ ! -f "$policy" ]; then
    echo "ERROR: policy file not found: $policy"
    exit 1
  fi

  echo "Creating policy from: $(basename "$policy")"
  gcloud alpha monitoring policies create \
    --project="$PROJECT_ID" \
    --policy-from-file="$policy" || {
    echo "ERROR: failed to create policy from $(basename "$policy")"
    exit 1
  }
done

echo ""
echo "Monitoring policy setup complete."
echo "Next steps:"
echo "1. Attach notification channels to the created policies in Cloud Monitoring."
echo "2. Add dashboard charts for:"
echo "   - streamforge_http_request_duration_ms"
echo "   - streamforge_pipeline_upload_to_first_stage_start_ms"
echo "   - streamforge_pipeline_end_to_end_ms"
echo "   - streamforge_pipeline_success_rate"
echo ""
