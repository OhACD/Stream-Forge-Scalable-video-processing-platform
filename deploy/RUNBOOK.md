# Stream Forge Cloud Run Deployment Runbook

This runbook provides step-by-step instructions for deploying Stream Forge to GCP Cloud Run using the Option 2 architecture (split workers for 3-4× speedup).

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Initial Setup](#initial-setup)
4. [Deployment Steps](#deployment-steps)
5. [Verification](#verification)
6. [Troubleshooting](#troubleshooting)
7. [Rollback](#rollback)
8. [Monitoring](#monitoring)

## Architecture Overview

Stream Forge uses a split-worker architecture on Cloud Run:

- **API Service**: Single HTTP-only service for handling API requests (1 core, 2Gi memory)
- **Worker Services**: Three dedicated Cloud Run services, each processing one profile queue:
  - `stream-forge-worker-1080p`: 4-core for high-resolution, slow transcoding
  - `stream-forge-worker-720p`: 4-core for medium-resolution
  - `stream-forge-worker-480p`: 2-core for mobile/low-bandwidth profiles

**Benefits:**
- 3-4× faster transcode completion (120s local → 40-50s cloud)
- Independent scaling per profile (queue depth triggers scaling)
- Better CPU utilization (2 concurrent jobs × 2 ffmpeg threads per job = 4 cores)

## Prerequisites

### Local Requirements
- `gcloud` CLI installed and authenticated
- Docker installed and running
- Git repository cloned with all deployment files

### GCP Setup
- Active GCP project with billing enabled
- Container Registry (gcr.io) access
- Cloud Run, Firestore, Cloud Storage, Cloud Memorystore (Redis), Secret Manager APIs enabled

### Required Environment Variables
```bash
export GCP_PROJECT_ID="your-gcp-project-id"
export GCP_REGION="us-central1"  # or your preferred region
export ENVIRONMENT="staging"      # or "prod"
```

## Initial Setup

### 1. Authenticate with GCP

```bash
gcloud auth login
gcloud config set project $GCP_PROJECT_ID
gcloud auth configure-docker
```

### 2. Run Infrastructure Provisioning

```bash
cd deploy
./gcp-provision.sh
```

This script will:
- Enable required APIs
- Create Firestore database
- Create Cloud Storage bucket
- Create Cloud Memorystore Redis instance
- Create service accounts and IAM roles
- Create Secret Manager secrets

**Important**: Update the internal token secret with a strong value:
```bash
echo -n 'YOUR_STRONG_RANDOM_TOKEN_HERE' | \
  gcloud secrets versions add stream-forge-internal-token --data-file=-
```

### 3. Verify Infrastructure

```bash
# Verify Firestore
gcloud firestore databases describe --database='(default)'

# Verify Storage bucket
gsutil ls -b gs://stream-forge-${ENVIRONMENT}-${GCP_PROJECT_ID}

# Verify Redis
gcloud redis instances describe stream-forge-${ENVIRONMENT} --region=$GCP_REGION

# Verify service accounts
gcloud iam service-accounts list | grep stream-forge

# Verify secrets
gcloud secrets list | grep stream-forge
```

## Deployment Steps

### 1. Build and Push Docker Image

The `gcp-deploy.sh` script handles this automatically, but you can also do it manually:

```bash
# From the monorepo root
docker build -t gcr.io/$GCP_PROJECT_ID/stream-forge-api:latest \
  -f apps/api/Dockerfile .

docker push gcr.io/$GCP_PROJECT_ID/stream-forge-api:latest
```

### 2. Deploy All Services

From the root of the monorepo:

```bash
cd deploy
GCP_PROJECT_ID=$GCP_PROJECT_ID GCP_REGION=$GCP_REGION ./gcp-deploy.sh
```

The script will:
1. Build Docker image
2. Push to gcr.io
3. Deploy API service (1 replica)
4. Deploy worker services in parallel (1 replica each)
5. Validate all services are ready

**Expected output:**
```
✓ Image pushed: gcr.io/PROJECT_ID/stream-forge-api:latest
✓ API service deployed
✓ Worker services deployed (1080p, 720p, 480p)
✓ stream-forge-api: READY (https://...)
✓ stream-forge-worker-1080p: READY (https://...)
✓ stream-forge-worker-720p: READY (https://...)
✓ stream-forge-worker-480p: READY (https://...)
```

### 3. Monitor Deployment Progress

```bash
# Watch API service
gcloud run services describe stream-forge-api --region=$GCP_REGION

# Watch worker services
gcloud run services describe stream-forge-worker-1080p --region=$GCP_REGION
gcloud run services describe stream-forge-worker-720p --region=$GCP_REGION
gcloud run services describe stream-forge-worker-480p --region=$GCP_REGION
```

## Verification

### 1. Check Service Status

```bash
gcloud run services list --region=$GCP_REGION | grep stream-forge
```

All services should show "OK" status.

### 2. View Recent Logs

```bash
# API service logs
gcloud run services logs read stream-forge-api --region=$GCP_REGION --limit=50

# Worker logs
gcloud run services logs read stream-forge-worker-1080p --region=$GCP_REGION --limit=50
gcloud run services logs read stream-forge-worker-720p --region=$GCP_REGION --limit=50
gcloud run services logs read stream-forge-worker-480p --region=$GCP_REGION --limit=50
```

### 3. Run Acceptance Test

Upload a test video through the API and verify transcoding:

```bash
# Get API URL
API_URL=$(gcloud run services describe stream-forge-api \
  --region=$GCP_REGION \
  --format='value(status.url)')

# Create a test video (or use existing test asset)
echo "Uploading test video to $API_URL"

# Monitor worker logs to see processing
gcloud run services logs read stream-forge-worker-1080p \
  --region=$GCP_REGION \
  --limit=100 \
  --follow
```

### 4. Verify Worker Scaling

Submit multiple transcode jobs and verify workers scale up:

```bash
# Submit 10 transcode jobs
for i in {1..10}; do
  # Submit transcode request via API
  echo "Submitting transcode job $i..."
done

# Check replica counts
gcloud run services describe stream-forge-worker-1080p \
  --region=$GCP_REGION \
  --format='value(status.traffic[0].percent,status.traffic[0].revisions[0].name)'

# Verify jobs are processing
gcloud run services logs read stream-forge-worker-1080p \
  --region=$GCP_REGION \
  --limit=20 \
  --follow
```

## Troubleshooting

### Service Won't Start

**Symptom**: Service shows "Creating revisions" for >5 minutes

**Diagnosis**:
```bash
gcloud run services describe stream-forge-api --region=$GCP_REGION
```

**Common Causes & Solutions**:

1. **Image not found**
   ```bash
   # Verify image exists in Container Registry
   gcloud container images list | grep stream-forge
   # Rebuild and push if needed
   docker build -t gcr.io/$GCP_PROJECT_ID/stream-forge-api:latest .
   docker push gcr.io/$GCP_PROJECT_ID/stream-forge-api:latest
   ```

2. **Secret not accessible**
   ```bash
   # Verify secret exists
   gcloud secrets describe stream-forge-redis-url
   # Verify service account has access
   gcloud secrets get-iam-policy stream-forge-redis-url
   ```

3. **Redis not reachable**
   ```bash
   # Verify Redis instance is running
   gcloud redis instances describe stream-forge-${ENVIRONMENT} --region=$GCP_REGION
   # Check connection string
   gcloud secrets versions access latest --secret=stream-forge-redis-url
   ```

### High Error Rate

**Symptom**: Logs show repeated failures

**Diagnosis**:
```bash
# View detailed error logs
gcloud run services logs read stream-forge-api --region=$GCP_REGION --limit=100 | grep -i error

# Check metrics
gcloud monitoring metrics-descriptors list | grep stream-forge
```

**Common Causes**:
- **Auth failure**: Verify Firebase config and GOOGLE_APPLICATION_CREDENTIALS
- **Storage failure**: Verify bucket exists and service account has access
- **Firestore failure**: Verify database initialized
- **Queue timeout**: Worker taking too long; check ffmpeg performance

### Workers Not Processing Jobs

**Symptom**: Jobs sit in queue, workers report no activity

**Diagnosis**:
```bash
# Check worker logs
gcloud run services logs read stream-forge-worker-1080p --region=$GCP_REGION --limit=50

# Check if workers are initialized
gcloud run services logs read stream-forge-worker-1080p --region=$GCP_REGION | grep -i "worker initialized\|profile"

# Check Redis connection
gcloud run services logs read stream-forge-worker-1080p --region=$GCP_REGION | grep -i "redis\|queue"
```

**Solutions**:
- Ensure `STREAM_FORGE_WORKER_PROFILE` env var is set correctly in YAML
- Verify Redis connectivity from worker logs
- Restart service: `gcloud run services update-traffic stream-forge-worker-1080p --to-revisions LATEST=100 --region=$GCP_REGION`

## Rollback

### Rollback to Previous Revision

```bash
# List revisions
gcloud run revisions list --filter="SERVICE:stream-forge-api" --region=$GCP_REGION

# Update traffic to previous revision
PREVIOUS_REVISION="stream-forge-api-00002"  # Replace with actual revision
gcloud run services update-traffic stream-forge-api \
  --to-revisions=$PREVIOUS_REVISION=100 \
  --region=$GCP_REGION

# Verify rollback
gcloud run services describe stream-forge-api --region=$GCP_REGION
```

### Delete Entire Deployment (Full Rollback)

```bash
# Delete services
gcloud run services delete stream-forge-api stream-forge-worker-1080p \
  stream-forge-worker-720p stream-forge-worker-480p \
  --region=$GCP_REGION \
  --quiet

# Verify deletion
gcloud run services list --region=$GCP_REGION | grep stream-forge
```

**Note**: This does NOT delete data in Firestore, Storage, or Redis. To delete infrastructure:
```bash
./gcp-provision.sh  # If you add delete logic
# Or manually delete:
gsutil -m rm -r gs://stream-forge-${ENVIRONMENT}-${GCP_PROJECT_ID}
gcloud redis instances delete stream-forge-${ENVIRONMENT} --region=$GCP_REGION
```

## Monitoring

Baseline policy templates are provided in `deploy/monitoring/`.
Apply them with:

```bash
GCP_PROJECT_ID=$GCP_PROJECT_ID ./deploy/gcp-monitoring-setup.sh
```

Use `deploy/STAGING_DRILL_CHECKLIST.md` to execute and record the staging drill and rollback rehearsal.

### Set Up Cloud Monitoring Dashboard

```bash
# View default metrics
gcloud monitoring dashboards list

# Create custom dashboard (use Cloud Console for now)
# Path: Cloud Monitoring → Dashboards → Create Dashboard
# Add charts for:
# - Request count (api service)
# - Error rate (all services)
# - Transcode latency (p50, p95, p99)
# - Worker queue depth
# - CPU utilization per service
# - Memory utilization per service
```

### Set Up Alerts

```bash
# High error rate alert (>5%)
gcloud alpha monitoring policies create \
  --notification-channels=YOUR_CHANNEL_ID \
  --display-name="Stream Forge High Error Rate" \
  --condition-display-name="Error rate >5%"

# High latency alert (p95 > 90s)
gcloud alpha monitoring policies create \
  --notification-channels=YOUR_CHANNEL_ID \
  --display-name="Stream Forge High Latency" \
  --condition-display-name="p95 latency >90s"
```

### Export Logs to BigQuery

```bash
# Create BigQuery dataset
bq mk --dataset \
  --location=$GCP_REGION \
  stream_forge_logs

# Create log sink
gcloud logging sinks create stream-forge-bigquery \
  bigquery.googleapis.com/projects/$GCP_PROJECT_ID/datasets/stream_forge_logs \
  --log-filter='resource.type="cloud_run_revision" AND resource.labels.service_name=~"stream-forge.*"'
```

## Performance Baselines

After successful deployment, you should observe:

| Metric | Expected Value | 
|--------|----------------|
| 1080p transcode time | 40-50 seconds (vs 120s locally) |
| 720p transcode time | 30-40 seconds |
| 480p transcode time | 20-30 seconds |
| API latency (p95) | <500ms (excluding transcode) |
| Error rate | <1% |
| Worker cold start | <10 seconds |

If you're seeing different values, review:
- Worker CPU/memory allocation
- Redis latency
- ffmpeg encoder settings
- Chunk duration (currently 30s)

## Related Documentation

- [Architecture Overview](../02-Architecture/README.md)
- [Workers Design](../07-Workers/README.md)
- [Queue System](../08-Queue-System/README.md)
- [ADR-003: Worker Architecture](../14-ADR/ADR-003-Worker-Architecture.md)
