import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { execFile as execFileCb } from "node:child_process";
import { ThumbnailAsset, TranscodeVariant, VideoMetadata } from "@stream-forge/contracts";
import { ensureLocalObjectParent, resolveLocalObjectPath } from "../storage/local-object-storage.js";

const execFile = promisify(execFileCb);

type MediaPipelineMode = "simulated" | "real";

function mediaPipelineMode(): MediaPipelineMode {
  const raw = process.env.STREAM_FORGE_MEDIA_PIPELINE_MODE;
  return raw === "real" ? "real" : "simulated";
}

function ffmpegThreadsPerJob(): number {
  const raw = process.env.STREAM_FORGE_FFMPEG_THREADS_PER_JOB;
  if (!raw) {
    return 1;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }

  return parsed;
}

function ffmpegVideoEncoder(): string {
  const raw = process.env.STREAM_FORGE_FFMPEG_VIDEO_ENCODER?.trim();
  if (!raw) {
    return "libx264";
  }

  return raw;
}

export function isRealMediaPipelineEnabled(): boolean {
  return mediaPipelineMode() === "real";
}

async function runBinary(command: string, args: string[]): Promise<string> {
  const { stdout, stderr } = await execFile(command, args, { maxBuffer: 10 * 1024 * 1024 });
  const text = String(stdout || "").trim();
  if (text.length > 0) {
    return text;
  }

  return String(stderr || "").trim();
}

async function ensureMediaToolsAvailable(): Promise<void> {
  await runBinary("ffprobe", ["-version"]);
  await runBinary("ffmpeg", ["-version"]);
}

type ProbeResult = {
  format?: {
    duration?: string;
    bit_rate?: string;
  };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
  }>;
};

function parseFrameRate(raw?: string): number {
  if (!raw || raw === "0/0") {
    return 30;
  }

  const [numRaw, denRaw] = raw.split("/");
  const num = Number(numRaw ?? "0");
  const den = Number(denRaw ?? "1");
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return 30;
  }

  return num / den;
}

export async function extractVideoMetadata(objectPath: string): Promise<VideoMetadata> {
  await ensureMediaToolsAvailable();
  const absolutePath = resolveLocalObjectPath(objectPath);
  const output = await runBinary("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    absolutePath
  ]);

  const parsed = JSON.parse(output) as ProbeResult;
  const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video");
  if (!videoStream) {
    throw new Error("VIDEO_STREAM_NOT_FOUND");
  }

  const durationSeconds = Number(parsed.format?.duration ?? "0");
  const bitRate = Number(parsed.format?.bit_rate ?? "0");

  return {
    codec: videoStream.codec_name ?? "unknown",
    durationMs: Math.max(1, Math.floor(durationSeconds * 1000)),
    width: Math.max(1, videoStream.width ?? 1),
    height: Math.max(1, videoStream.height ?? 1),
    frameRate: parseFrameRate(videoStream.avg_frame_rate),
    bitrateKbps: Math.max(1, Math.floor(bitRate / 1000) || 1)
  };
}

export async function generateRealThumbnails(videoId: string, tenantId: string, sourceObjectPath: string, durationMs: number): Promise<ThumbnailAsset[]> {
  await ensureMediaToolsAvailable();
  const sourcePath = resolveLocalObjectPath(sourceObjectPath);

  const posterTimestamp = Math.max(1, Math.floor(durationMs * 0.25));
  const timelineTimestamp = Math.min(Math.max(1, posterTimestamp + 5000), Math.max(1, durationMs - 1));

  const posterObjectPath = `tenants/${tenantId}/videos/${videoId}/thumbnails/poster.jpg`;
  const timelineObjectPath = `tenants/${tenantId}/videos/${videoId}/thumbnails/timeline-0001.jpg`;
  const posterPath = await ensureLocalObjectParent(posterObjectPath);
  const timelinePath = await ensureLocalObjectParent(timelineObjectPath);

  await runBinary("ffmpeg", [
    "-y",
    "-ss",
    `${posterTimestamp / 1000}`,
    "-i",
    sourcePath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    posterPath
  ]);

  await runBinary("ffmpeg", [
    "-y",
    "-ss",
    `${timelineTimestamp / 1000}`,
    "-i",
    sourcePath,
    "-frames:v",
    "1",
    "-vf",
    "scale=640:360",
    "-q:v",
    "4",
    timelinePath
  ]);

  return [
    {
      type: "poster",
      objectPath: posterObjectPath,
      width: 1280,
      height: 720,
      timestampMs: posterTimestamp
    },
    {
      type: "timeline",
      objectPath: timelineObjectPath,
      width: 640,
      height: 360,
      timestampMs: timelineTimestamp
    }
  ];
}

export async function transcodeChunkForProfile(
  sourceObjectPath: string,
  outputObjectPath: string,
  profile: TranscodeVariant,
  startMs: number,
  endMs: number
): Promise<void> {
  await ensureMediaToolsAvailable();
  const sourcePath = resolveLocalObjectPath(sourceObjectPath);
  const outputPath = await ensureLocalObjectParent(outputObjectPath);
  const startSeconds = Math.max(0, startMs) / 1000;
  const durationSeconds = Math.max(0.05, endMs - startMs) / 1000;
  const threads = ffmpegThreadsPerJob();
  const preset = profile.profile === "480p" ? "ultrafast" : "veryfast";
  const videoEncoder = ffmpegVideoEncoder();

  const videoArgs: string[] = ["-c:v", videoEncoder];
  if (videoEncoder === "libx264") {
    videoArgs.push("-preset", preset, "-threads", `${threads}`);
  }

  videoArgs.push("-b:v", `${profile.bitrateKbps}k`);

  await runBinary("ffmpeg", [
    "-y",
    "-ss",
    `${startSeconds}`,
    "-i",
    sourcePath,
    "-t",
    `${durationSeconds}`,
    "-vf",
    `scale=${profile.width}:${profile.height}`,
    ...videoArgs,
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    outputPath
  ]);
}

export async function reassembleVariantChunks(outputObjectPath: string, chunkObjectPaths: string[]): Promise<void> {
  await ensureMediaToolsAvailable();

  const outputPath = await ensureLocalObjectParent(outputObjectPath);
  const tempDir = await mkdtemp(join(tmpdir(), "stream-forge-concat-"));
  const listPath = join(tempDir, `${basename(outputPath)}.txt`);
  const lines = chunkObjectPaths
    .map((chunkObjectPath) => resolveLocalObjectPath(chunkObjectPath))
    .map((absolutePath) => `file '${absolutePath.replace(/'/g, "'\\''")}'`)
    .join("\n");

  await writeFile(listPath, `${lines}\n`, "utf8");

  await runBinary("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    outputPath
  ]);
}

export async function writeTranscriptFile(objectPath: string, language: string, durationMs: number): Promise<void> {
  const absolutePath = await ensureLocalObjectParent(objectPath);
  const hh = String(Math.floor(durationMs / 3_600_000)).padStart(2, "0");
  const mm = String(Math.floor((durationMs % 3_600_000) / 60_000)).padStart(2, "0");
  const ss = String(Math.floor((durationMs % 60_000) / 1000)).padStart(2, "0");
  const ms = String(durationMs % 1000).padStart(3, "0");
  const cueEnd = `${hh}:${mm}:${ss}.${ms}`;

  const content = [
    "WEBVTT",
    "",
    "1",
    `00:00:00.000 --> ${cueEnd}`,
    `Auto transcript placeholder (${language}). Integrate speech-to-text provider for production captions.`,
    ""
  ].join("\n");

  await writeFile(absolutePath, content, "utf8");
}

export function sortChunkOutputsByIndex(paths: Array<{ chunkIndex: number; objectPath: string }>): string[] {
  return [...paths].sort((a, b) => a.chunkIndex - b.chunkIndex).map((entry) => entry.objectPath);
}
