# Deployment Guide (GCP Cloud Run)

This guide is the simple path to deploy Stream Forge on GCP.

## Prerequisites

- Google Cloud CLI installed (`gcloud`)
- Authenticated account (`gcloud auth login`)
- Active project (`gcloud config set project <PROJECT_ID>`)
- Docker installed

## Required environment variables

```bash
export GCP_PROJECT_ID="<your-project-id>"
export GCP_REGION="us-central1"
export ENVIRONMENT="staging"
```

## 1) Provision infrastructure

```bash
./deploy/gcp-provision.sh
```

This provisions:

- Firestore
- Cloud Storage bucket
- Memorystore Redis
- Service accounts + IAM
- Secret Manager secrets

## 2) Deploy services

```bash
./deploy/gcp-deploy.sh
```

This deploys:

- `stream-forge-api`
- `stream-forge-worker-1080p`
- `stream-forge-worker-720p`
- `stream-forge-worker-480p`

## 3) Apply monitoring baseline

```bash
./deploy/gcp-monitoring-setup.sh
```

Then attach notification channels in Cloud Monitoring.

## 4) Run staging drill

Follow:

- `deploy/STAGING_DRILL_CHECKLIST.md`

## 5) Validate readiness

Use:

- `deploy/ENVIRONMENT_SECRET_MATRIX.md`
- `deploy/RUNBOOK.md`
- `StreamForgeDocs/00-Overview/V1-Release-Readiness-Checklist.md`

## Notes

- Production requires `STREAM_FORGE_INTERNAL_TOKEN`.
- Keep secrets in Secret Manager only.
- Promote to production only after staging drill and rollback rehearsal pass.
