#!/bin/bash

# GCP Infrastructure Provisioning Script for Stream Forge
# Sets up Firestore, Storage, Redis, service accounts, IAM, and secrets

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${GCP_REGION:-us-central1}"
ENVIRONMENT="${ENVIRONMENT:-prod}"

if [ -z "$PROJECT_ID" ] || [ "$PROJECT_ID" = "(unset)" ]; then
  echo "ERROR: GCP_PROJECT_ID not set"
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI is required but not installed"
  exit 1
fi

if ! command -v gsutil >/dev/null 2>&1; then
  echo "ERROR: gsutil is required but not installed"
  exit 1
fi

echo "=========================================="
echo "Stream Forge GCP Infrastructure Provisioning"
echo "=========================================="
echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "Environment: $ENVIRONMENT"
echo ""

# Ensure we're in the right project
gcloud config set project "$PROJECT_ID"

# Enable required APIs
echo "Step 1: Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  redis.googleapis.com \
  secretmanager.googleapis.com \
  cloudtasks.googleapis.com \
  --project="$PROJECT_ID" --quiet

echo "✓ APIs enabled"
echo ""

# Create Firestore database if not exists
echo "Step 2: Setting up Cloud Firestore..."
if gcloud firestore databases describe \
  --database='(default)' \
  --project="$PROJECT_ID" &>/dev/null; then
  echo "✓ Firestore database already exists"
else
  gcloud firestore databases create \
    --database='(default)' \
    --region="$REGION" \
    --project="$PROJECT_ID"
  echo "✓ Firestore database created"
fi
echo ""

# Create Cloud Storage bucket if not exists
echo "Step 3: Setting up Cloud Storage..."
BUCKET_NAME="stream-forge-$ENVIRONMENT-$PROJECT_ID"
if gsutil ls -b "gs://$BUCKET_NAME" &>/dev/null; then
  echo "✓ Storage bucket already exists: gs://$BUCKET_NAME"
else
  gsutil mb -l "$REGION" "gs://$BUCKET_NAME"
  gsutil versioning set off "gs://$BUCKET_NAME"
  echo "✓ Storage bucket created: gs://$BUCKET_NAME"
fi
echo ""

# Create Cloud Memorystore Redis instance if not exists
echo "Step 4: Setting up Cloud Memorystore Redis..."
REDIS_INSTANCE="stream-forge-$ENVIRONMENT"
if gcloud redis instances describe "$REDIS_INSTANCE" \
  --region="$REGION" \
  --project="$PROJECT_ID" &>/dev/null; then
  echo "✓ Redis instance already exists: $REDIS_INSTANCE"
  REDIS_HOST=$(gcloud redis instances describe "$REDIS_INSTANCE" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --format='value(host)')
else
  gcloud redis instances create "$REDIS_INSTANCE" \
    --size=5 \
    --region="$REGION" \
    --redis-version=7.0 \
    --project="$PROJECT_ID" \
    --quiet
  echo "✓ Redis instance created: $REDIS_INSTANCE"
  REDIS_HOST=$(gcloud redis instances describe "$REDIS_INSTANCE" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --format='value(host)')
fi

REDIS_PORT=6379
REDIS_URL="redis://$REDIS_HOST:$REDIS_PORT"
echo "  Redis URL: $REDIS_URL"
echo ""

# Create service accounts
echo "Step 5: Creating service accounts..."

# API service account
API_SA="stream-forge-api"
if gcloud iam service-accounts describe "$API_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --project="$PROJECT_ID" &>/dev/null; then
  echo "✓ API service account already exists: $API_SA"
else
  gcloud iam service-accounts create "$API_SA" \
    --display-name="Stream Forge API Service" \
    --project="$PROJECT_ID"
  echo "✓ API service account created: $API_SA"
fi

# Worker service account
WORKER_SA="stream-forge-worker"
if gcloud iam service-accounts describe "$WORKER_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --project="$PROJECT_ID" &>/dev/null; then
  echo "✓ Worker service account already exists: $WORKER_SA"
else
  gcloud iam service-accounts create "$WORKER_SA" \
    --display-name="Stream Forge Worker Service" \
    --project="$PROJECT_ID"
  echo "✓ Worker service account created: $WORKER_SA"
fi
echo ""

# Grant IAM roles
echo "Step 6: Granting IAM roles..."

# Firestore roles
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$API_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user" \
  --condition=None \
  --quiet 2>/dev/null || true

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$WORKER_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user" \
  --condition=None \
  --quiet 2>/dev/null || true

# Storage roles
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$API_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.admin" \
  --condition=None \
  --quiet 2>/dev/null || true

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$WORKER_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.admin" \
  --condition=None \
  --quiet 2>/dev/null || true

echo "✓ IAM roles granted (Firestore, Storage)"
echo ""

# Create Secret Manager secrets
echo "Step 7: Creating Secret Manager secrets..."

# Redis URL secret
if gcloud secrets describe stream-forge-redis-url \
  --project="$PROJECT_ID" &>/dev/null; then
  echo "  Updating existing secret: stream-forge-redis-url"
  echo -n "$REDIS_URL" | gcloud secrets versions add stream-forge-redis-url \
    --data-file=- \
    --project="$PROJECT_ID"
else
  echo "  Creating new secret: stream-forge-redis-url"
  echo -n "$REDIS_URL" | gcloud secrets create stream-forge-redis-url \
    --data-file=- \
    --replication-policy="automatic" \
    --project="$PROJECT_ID"
fi
echo "✓ Redis URL secret stored"

# Internal token secret (placeholder - user must provide)
if gcloud secrets describe stream-forge-internal-token \
  --project="$PROJECT_ID" &>/dev/null; then
  echo "  stream-forge-internal-token already exists (skipping)"
else
  echo "  Creating new secret: stream-forge-internal-token"
  echo -n "REPLACE_ME_WITH_STRONG_TOKEN" | gcloud secrets create stream-forge-internal-token \
    --data-file=- \
    --replication-policy="automatic" \
    --project="$PROJECT_ID"
  echo "  ⚠  Replace with actual token:"
  echo "     echo -n 'YOUR_STRONG_TOKEN' | gcloud secrets versions add stream-forge-internal-token --data-file=-"
fi

echo "✓ Secrets created in Secret Manager"
echo ""

# Grant service accounts access to secrets
echo "Step 8: Granting service accounts access to secrets..."

gcloud secrets add-iam-policy-binding stream-forge-redis-url \
  --member="serviceAccount:$API_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None \
  --quiet 2>/dev/null || true

gcloud secrets add-iam-policy-binding stream-forge-redis-url \
  --member="serviceAccount:$WORKER_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None \
  --quiet 2>/dev/null || true

gcloud secrets add-iam-policy-binding stream-forge-internal-token \
  --member="serviceAccount:$API_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None \
  --quiet 2>/dev/null || true

gcloud secrets add-iam-policy-binding stream-forge-internal-token \
  --member="serviceAccount:$WORKER_SA@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor" \
  --condition=None \
  --quiet 2>/dev/null || true

echo "✓ Service account secret access granted"
echo ""

echo "=========================================="
echo "Infrastructure Provisioning Complete!"
echo "=========================================="
echo ""
echo "Configuration Summary:"
echo "  Project: $PROJECT_ID"
echo "  Region: $REGION"
echo "  Environment: $ENVIRONMENT"
echo "  Firestore DB: (default)"
echo "  Storage Bucket: gs://$BUCKET_NAME"
echo "  Redis Instance: $REDIS_INSTANCE"
echo "  Redis URL: $REDIS_URL"
echo "  API Service Account: $API_SA@$PROJECT_ID.iam.gserviceaccount.com"
echo "  Worker Service Account: $WORKER_SA@$PROJECT_ID.iam.gserviceaccount.com"
echo ""
echo "Next steps:"
echo "1. Update internal token secret:"
echo "   echo -n 'YOUR_STRONG_TOKEN' | gcloud secrets versions add stream-forge-internal-token --data-file=-"
echo ""
echo "2. Run deployment:"
echo "   GCP_PROJECT_ID=$PROJECT_ID GCP_REGION=$REGION $REPO_ROOT/deploy/gcp-deploy.sh"
echo ""
