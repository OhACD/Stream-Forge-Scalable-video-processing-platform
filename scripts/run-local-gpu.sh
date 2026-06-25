#!/usr/bin/env bash
# run-local-gpu.sh — Run Stream Forge on macOS using Apple VideoToolbox (GPU) acceleration.
#
# Prerequisites:
#   - ffmpeg installed with VideoToolbox support (brew install ffmpeg)
#   - Docker running (used for Redis only)
#   - npm install already run in repo root
#
# Usage:
#   ./scripts/run-local-gpu.sh            # default: h264_videotoolbox
#   ENCODER=hevc_videotoolbox ./scripts/run-local-gpu.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENCODER="${ENCODER:-h264_videotoolbox}"
REDIS_PORT="${REDIS_PORT:-6379}"

# ── Verify ffmpeg supports the chosen encoder ──────────────────────────────
if ! ffmpeg -hide_banner -encoders 2>/dev/null | grep -q "$ENCODER"; then
  echo "ERROR: ffmpeg encoder '$ENCODER' not available on this machine."
  echo "       Install a full ffmpeg build: brew install ffmpeg"
  exit 1
fi

echo "✓ Encoder '$ENCODER' available"

# ── Start Redis (Docker) if not already running ────────────────────────────
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "stream-forge-redis"; then
  echo "→ Starting Redis via Docker…"
  docker compose -f "$REPO_ROOT/docker-compose.redis.yml" up -d
  # Give Redis a moment to be ready
  for i in $(seq 1 10); do
    if docker exec "$(docker ps -qf name=stream-forge-redis)" redis-cli ping 2>/dev/null | grep -q PONG; then
      break
    fi
    sleep 0.5
  done
  echo "✓ Redis ready"
else
  echo "✓ Redis already running"
fi

# ── Flush stale BullMQ queues from any prior Docker session ───────────────
echo "→ Flushing stale job queues from Redis…"
REDIS_CONTAINER="$(docker ps -qf name=stream-forge-redis 2>/dev/null || true)"
if [[ -n "$REDIS_CONTAINER" ]]; then
  docker exec "$REDIS_CONTAINER" redis-cli FLUSHDB > /dev/null 2>&1 || true
  echo "✓ Redis queues cleared"
else
  echo "! Could not find Redis container to flush — continuing anyway"
fi

# ── Build all packages ─────────────────────────────────────────────────────
echo "→ Building packages…"
cd "$REPO_ROOT"
npm run build -w @stream-forge/contracts > /dev/null
npm run build -w @stream-forge/core > /dev/null
npm run build -w @stream-forge/api > /dev/null
echo "✓ Build complete"

# ── Launch API on host with VideoToolbox ───────────────────────────────────
# ── Start web dev server in background ────────────────────────────────────
echo "→ Starting web dev server…"
cd "$REPO_ROOT"
npm run dev -w @stream-forge/web &> /tmp/stream-forge-web-dev.log &
WEB_PID=$!
# Wait for Vite to become ready
for i in $(seq 1 20); do
  if grep -q "Local:" /tmp/stream-forge-web-dev.log 2>/dev/null; then
    break
  fi
  sleep 0.5
done
echo "✓ Web dev server running (pid $WEB_PID) — logs: /tmp/stream-forge-web-dev.log"

# On exit, kill the web dev server too
trap "kill $WEB_PID 2>/dev/null; echo '→ Stopped web dev server'" EXIT INT TERM

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Stream Forge — macOS GPU mode"
echo "  Encoder : $ENCODER"
echo "  API     : http://127.0.0.1:4000"
echo "  Web UI  : http://127.0.0.1:5173  ← open this"
echo ""
echo "  NOTE: Do NOT use localhost:3000 (Docker web)."
echo "        Always use the Vite URL above."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

export PORT=4000
export HOST=0.0.0.0
export STREAM_FORGE_REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"
export STREAM_FORGE_START_WORKERS=true
export STREAM_FORGE_MEDIA_PIPELINE_MODE=real
export STREAM_FORGE_AUTH_MODE=dev
export STREAM_FORGE_INTERNAL_TOKEN=dev-internal-token
export STREAM_FORGE_FFMPEG_VIDEO_ENCODER="$ENCODER"
export STREAM_FORGE_TRANSCODE_CHUNK_SECONDS=30
export STREAM_FORGE_TRANSCODE_CHUNK_WORKER_CONCURRENCY=6
export STREAM_FORGE_FFMPEG_THREADS_PER_JOB=2

npm run start -w @stream-forge/api
