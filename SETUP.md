# Setup Guide

This guide helps you run Stream Forge locally.

## Prerequisites

- Node.js 20+
- npm 10+
- Docker (optional, for full stack)
- ffmpeg and ffprobe on PATH (only for real media mode)

## Install

```bash
npm install
```

## Build

```bash
npm run build
```

## Run API only

```bash
npm run start -w @stream-forge/api
```

API health endpoint:

- `http://localhost:4000/health`

## Run full stack (Docker)

```bash
npm run docker:up
```

Endpoints:

- Web: `http://localhost:3000`
- API: `http://localhost:4000`

Stop stack:

```bash
npm run docker:down
```

## Useful local modes

- BullMQ + Redis queue mode:
  - `STREAM_FORGE_REDIS_URL=redis://localhost:6379`
- Start embedded workers in API process:
  - `STREAM_FORGE_START_WORKERS=true`
- Firebase auth mode:
  - `STREAM_FORGE_AUTH_MODE=firebase`
  - `STREAM_FORGE_FIREBASE_PROJECT_ID=<project-id>`
- Real media mode:
  - `STREAM_FORGE_MEDIA_PIPELINE_MODE=real`

## Tests

```bash
npm run test:acceptance -w @stream-forge/api
```
