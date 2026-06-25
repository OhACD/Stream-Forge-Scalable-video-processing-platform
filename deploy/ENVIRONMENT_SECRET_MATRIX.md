# Stream Forge Environment and Secret Matrix

This matrix defines required runtime configuration for dev, staging, and production.

## Environment-level settings

| Key | Dev | Staging | Production |
|---|---|---|---|
| `STREAM_FORGE_AUTH_MODE` | `dev` | `firebase` | `firebase` |
| `STREAM_FORGE_FIREBASE_PROJECT_ID` | optional | required | required |
| `STREAM_FORGE_REPOSITORY` | `memory` (default) | `firestore` | `firestore` |
| `STREAM_FORGE_REDIS_URL` | `redis://redis:6379` | Secret Manager | Secret Manager |
| `STREAM_FORGE_STORAGE_BUCKET` | local/HMAC signer fallback | required | required |
| `STREAM_FORGE_INTERNAL_TOKEN` | optional local | Secret Manager | Secret Manager |
| `STREAM_FORGE_MEDIA_PIPELINE_MODE` | `simulated` or `real` | `real` | `real` |
| `STREAM_FORGE_TRANSCODE_CHUNK_SECONDS` | `30` | `30` | `30` |
| `STREAM_FORGE_TRANSCODE_CHUNK_WORKER_CONCURRENCY` | `6` (dev memory mode) | `2` | `2` |
| `STREAM_FORGE_FFMPEG_THREADS_PER_JOB` | `2` | `2` | `2` |

## Cloud Run service profile settings

| Service | Required env | CPU | Memory |
|---|---|---|---|
| `stream-forge-api` | no worker profile | 1 | 2Gi |
| `stream-forge-worker-1080p` | `STREAM_FORGE_WORKER_PROFILE=1080p` | 4 | 8Gi |
| `stream-forge-worker-720p` | `STREAM_FORGE_WORKER_PROFILE=720p` | 4 | 8Gi |
| `stream-forge-worker-480p` | `STREAM_FORGE_WORKER_PROFILE=480p` | 2 | 4Gi |

## Secret Manager mapping

| Secret name | Key/version used in Cloud Run | Used by | Purpose |
|---|---|---|---|
| `stream-forge-redis-url` | `latest` | API + workers | Queue backend endpoint |
| `stream-forge-internal-token` | `latest` | API + workers | Protect internal/admin routes |

## Service accounts and minimum roles

| Service account | Required roles |
|---|---|
| `stream-forge-api@PROJECT_ID.iam.gserviceaccount.com` | `roles/datastore.user`, `roles/storage.admin`, `roles/secretmanager.secretAccessor` |
| `stream-forge-worker@PROJECT_ID.iam.gserviceaccount.com` | `roles/datastore.user`, `roles/storage.admin`, `roles/secretmanager.secretAccessor` |

## Validation checklist

1. `gcloud secrets list | grep stream-forge`
2. `gcloud run services list --region=$GCP_REGION | grep stream-forge`
3. `gcloud run services describe stream-forge-api --region=$GCP_REGION`
4. `gcloud run services describe stream-forge-worker-1080p --region=$GCP_REGION`
5. `gcloud run services describe stream-forge-worker-720p --region=$GCP_REGION`
6. `gcloud run services describe stream-forge-worker-480p --region=$GCP_REGION`
