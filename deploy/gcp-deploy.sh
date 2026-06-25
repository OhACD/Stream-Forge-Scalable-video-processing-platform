#!/bin/bash

# Cloud Run Deployment Script for Stream Forge Option 2 Architecture
# Deploys API + 3 profile-specific worker services

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
REGION="${GCP_REGION:-us-central1}"
VERSION="${VERSION:-$(date +%Y%m%d-%H%M%S)}"

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  echo "ERROR: GCP_PROJECT_ID not set and no default gcloud project configured"
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI is required but not installed"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required but not installed"
  exit 1
fi

echo "=========================================="
echo "Stream Forge Cloud Run Deployment"
echo "=========================================="
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "Image Tag: $IMAGE_TAG"
echo "Version: $VERSION"
echo ""

# Step 1: Build and push Docker image
echo "Step 1: Building and pushing Docker image..."
IMAGE_URL="gcr.io/$PROJECT_ID/stream-forge-api:$IMAGE_TAG"

docker build -t "$IMAGE_URL" \
  --build-arg BUILD_DATE="$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --build-arg VCS_REF="$(git rev-parse --short HEAD)" \
  -f "$REPO_ROOT/apps/api/Dockerfile" \
  "$REPO_ROOT" || {
  echo "ERROR: Docker build failed"
  exit 1
}

docker push "$IMAGE_URL" || {
  echo "ERROR: Docker push failed"
  exit 1
}

echo "✓ Image pushed: $IMAGE_URL"
echo ""

# Step 2: Update YAML manifests with actual project ID and image
echo "Step 2: Preparing YAML manifests..."
TEMP_DIR=$(mktemp -d)

for yaml_file in \
  "$REPO_ROOT/deploy/cloudrun/api-service.yaml" \
  "$REPO_ROOT/deploy/cloudrun/worker-1080p-service.yaml" \
  "$REPO_ROOT/deploy/cloudrun/worker-720p-service.yaml" \
  "$REPO_ROOT/deploy/cloudrun/worker-480p-service.yaml"; do
  
  if [ ! -f "$yaml_file" ]; then
    echo "ERROR: $yaml_file not found"
    exit 1
  fi
  
  # Replace placeholders
  sed "s|PROJECT_ID|$PROJECT_ID|g; s|:latest|:$IMAGE_TAG|g" \
    "$yaml_file" > "$TEMP_DIR/$(basename "$yaml_file")"
done

echo "✓ YAML manifests prepared in $TEMP_DIR"
echo ""

# Step 3: Deploy API service
echo "Step 3: Deploying API service..."
gcloud run services replace "$TEMP_DIR/api-service.yaml" \
  --region="$REGION" \
  --project="$PROJECT_ID" || {
  echo "ERROR: API service deployment failed"
  exit 1
}
echo "✓ API service deployed"
echo ""

# Step 4: Deploy worker services in parallel
echo "Step 4: Deploying worker services..."
gcloud run services replace "$TEMP_DIR/worker-1080p-service.yaml" \
  --region="$REGION" \
  --project="$PROJECT_ID" &
PID_1080P=$!

gcloud run services replace "$TEMP_DIR/worker-720p-service.yaml" \
  --region="$REGION" \
  --project="$PROJECT_ID" &
PID_720P=$!

gcloud run services replace "$TEMP_DIR/worker-480p-service.yaml" \
  --region="$REGION" \
  --project="$PROJECT_ID" &
PID_480P=$!

# Wait for all deployments
wait $PID_1080P || { echo "ERROR: 1080p worker deployment failed"; exit 1; }
wait $PID_720P || { echo "ERROR: 720p worker deployment failed"; exit 1; }
wait $PID_480P || { echo "ERROR: 480p worker deployment failed"; exit 1; }

echo "✓ Worker services deployed (1080p, 720p, 480p)"
echo ""

# Step 5: Validate deployments
echo "Step 5: Validating deployments..."
services=("stream-forge-api" "stream-forge-worker-1080p" "stream-forge-worker-720p" "stream-forge-worker-480p")

for service in "${services[@]}"; do
  status=$(gcloud run services describe "$service" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --format='value(status.conditions[0].status)' 2>/dev/null || echo "UNKNOWN")
  
  if [ "$status" = "True" ]; then
    url=$(gcloud run services describe "$service" \
      --region="$REGION" \
      --project="$PROJECT_ID" \
      --format='value(status.url)' 2>/dev/null || echo "N/A")
    echo "✓ $service: READY ($url)"
  else
    echo "⚠ $service: Status unknown (may still be initializing)"
  fi
done
echo ""

# Step 6: Cleanup
rm -rf "$TEMP_DIR"

echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Verify all services are running:"
echo "   gcloud run services list --region=$REGION --project=$PROJECT_ID | grep stream-forge"
echo ""
echo "2. Run smoke test (upload video, verify transcode):"
echo "   See $REPO_ROOT/deploy/RUNBOOK.md for detailed testing procedure"
echo ""
echo "3. Monitor logs:"
echo "   gcloud run services logs read stream-forge-api --region=$REGION --project=$PROJECT_ID"
echo "   gcloud run services logs read stream-forge-worker-1080p --region=$REGION --project=$PROJECT_ID"
echo ""
