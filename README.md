# Stream Forge

Stream Forge is a scalable video processing API and platform.

It provides:

- Upload intent + file ingest APIs
- Queue-driven multi-stage video processing
- Profile-split transcode workers for horizontal scaling
- Event-driven processing lifecycle with replay support
- Prometheus-style metrics for API and pipeline SLIs
- A web app for upload and status operations

## Project layout

- `apps/api`: Fastify API + worker runtime
- `apps/web`: Vite frontend
- `packages/contracts`: shared API/event schemas
- `packages/core`: state-machine and domain logic
- `deploy`: Cloud Run deployment scripts, manifests, and runbooks

## Quick start (local)

Run commands from this directory.

1. `npm install`
2. `npm run build`
3. `npm run start -w @stream-forge/api`
4. Open health endpoint: `http://localhost:4000/health`

For full local stack via Docker:

1. `npm run docker:up`
2. Web app: `http://localhost:3000`
3. API health: `http://localhost:4000/health`
4. Stop stack: `npm run docker:down`

## Core scripts

- Build all: `npm run build`
- Typecheck: `npm run typecheck`
- API acceptance: `npm run test:acceptance -w @stream-forge/api`
- Queue smoke test: `npm run smoke:queue`

## Runtime modes

- Auth mode: `dev` (default local), `firebase`, `hybrid`
- Repository mode: in-memory (default local), Firestore via `STREAM_FORGE_REPOSITORY=firestore`
- Queue mode: in-memory (default) or BullMQ via `STREAM_FORGE_REDIS_URL`
- Media mode: `simulated` (default) or `real` via `STREAM_FORGE_MEDIA_PIPELINE_MODE=real`

## API highlights

- `POST /videos`: create upload intent
- `POST /videos/:id/upload`: upload bytes + enqueue processing
- `GET /videos`, `GET /videos/:id`, `GET /videos/:id/status`
- `POST /videos/:id/retry`: replay failed state
- `GET /metrics`: request + pipeline metrics

## Deployment

Use these simple guides:

- Setup and local usage: `SETUP.md`
- GCP deployment: `DEPLOYMENT.md`

Detailed runbooks and manifests:

- `deploy/RUNBOOK.md`
- `deploy/cloudrun/`

## CI and release quality

- CI workflow: `.github/workflows/ci.yml`
- Deploy-readiness workflow (manual-only for now): `.github/workflows/deployment-readiness.yml`
- Branch protection baseline: `.github/branch-protection.md`

## License

MIT. See `LICENSE`.
