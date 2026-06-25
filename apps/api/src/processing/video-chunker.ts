const MAX_CHUNK_DURATION_SECONDS = 59;
const DEFAULT_CHUNK_DURATION_SECONDS = 30;

export type VideoChunk = {
  index: number;
  startMs: number;
  endMs: number;
  durationMs: number;
};

function parsePositiveInteger(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function resolveChunkDurationSeconds(): number {
  const raw = process.env.STREAM_FORGE_TRANSCODE_CHUNK_SECONDS;
  if (!raw) {
    return DEFAULT_CHUNK_DURATION_SECONDS;
  }

  const parsed = parsePositiveInteger(raw);
  if (!parsed) {
    return DEFAULT_CHUNK_DURATION_SECONDS;
  }

  // Hard cap to keep each chunk under one minute.
  return Math.min(parsed, MAX_CHUNK_DURATION_SECONDS);
}

export function buildVideoChunks(totalDurationMs: number, chunkDurationSeconds: number): VideoChunk[] {
  if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) {
    return [];
  }

  const boundedChunkDurationSeconds = Math.max(1, Math.min(chunkDurationSeconds, MAX_CHUNK_DURATION_SECONDS));
  const chunkDurationMs = boundedChunkDurationSeconds * 1000;
  const chunks: VideoChunk[] = [];
  let startMs = 0;
  let index = 0;

  while (startMs < totalDurationMs) {
    const endMs = Math.min(startMs + chunkDurationMs, totalDurationMs);
    chunks.push({
      index,
      startMs,
      endMs,
      durationMs: endMs - startMs
    });

    startMs = endMs;
    index += 1;
  }

  return chunks;
}

export function chunkingEnabledForDuration(totalDurationMs: number): boolean {
  return totalDurationMs > 60_000;
}
