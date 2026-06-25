import { z } from "zod";

export const VideoLifecycleStatusSchema = z.enum([
  "queued",
  "processing",
  "partially_complete",
  "ready",
  "failed",
  "deleted"
]);

export type VideoLifecycleStatus = z.infer<typeof VideoLifecycleStatusSchema>;

export const VideoStageSchema = z.enum([
  "upload",
  "metadata",
  "thumbnail",
  "transcode-orchestration",
  "transcode-chunks-processing",
  "transcode-reassembly",
  "transcript",
  "notification"
]);

export type VideoStage = z.infer<typeof VideoStageSchema>;

export const VideoMetadataSchema = z.object({
  codec: z.string(),
  durationMs: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameRate: z.number().positive(),
  bitrateKbps: z.number().int().positive()
});

export type VideoMetadata = z.infer<typeof VideoMetadataSchema>;

export const ThumbnailAssetSchema = z.object({
  type: z.enum(["poster", "timeline"]),
  objectPath: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  timestampMs: z.number().int().nonnegative().optional()
});

export type ThumbnailAsset = z.infer<typeof ThumbnailAssetSchema>;

export const TranscodeVariantSchema = z.object({
  profile: z.enum(["1080p", "720p", "480p", "360p"]),
  objectPath: z.string().min(1),
  codec: z.string().min(1),
  bitrateKbps: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive()
});

export type TranscodeVariant = z.infer<typeof TranscodeVariantSchema>;

export const TranscriptSegmentSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string().min(1)
});

export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const VideoTranscriptSchema = z.object({
  language: z.string().min(1).optional(),
  objectPath: z.string().min(1).optional(),
  segments: z.array(TranscriptSegmentSchema).optional()
});

export type VideoTranscript = z.infer<typeof VideoTranscriptSchema>;

export const TranscodeChunkOutputSchema = z.object({
  profile: z.enum(["1080p", "720p", "480p", "360p"]),
  chunkIndex: z.number().int().nonnegative(),
  objectPath: z.string().min(1)
});

export type TranscodeChunkOutput = z.infer<typeof TranscodeChunkOutputSchema>;

export const TranscodeChunkStateSchema = z.object({
  chunkDurationSeconds: z.number().int().positive(),
  totalChunks: z.number().int().nonnegative(),
  profiles: z.array(z.enum(["1080p", "720p", "480p", "360p"])),
  expectedJobKeys: z.array(z.string().min(1)),
  completedJobKeys: z.array(z.string().min(1)),
  outputs: z.array(TranscodeChunkOutputSchema)
});

export type TranscodeChunkState = z.infer<typeof TranscodeChunkStateSchema>;

export const VideoRecordSchema = z.object({
  videoId: z.string().min(1),
  ownerUserId: z.string().min(1),
  tenantId: z.string().min(1),
  objectPath: z.string().min(1),
  declaredContentType: z.string().min(1).optional(),
  declaredSizeBytes: z.number().int().positive().optional(),
  sourceChecksumSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  status: VideoLifecycleStatusSchema,
  activeStage: VideoStageSchema.optional(),
  progressPercent: z.number().int().min(0).max(100),
  metadata: VideoMetadataSchema.optional(),
  thumbnails: z.array(ThumbnailAssetSchema).optional(),
  variants: z.array(TranscodeVariantSchema).optional(),
  transcript: VideoTranscriptSchema.optional(),
  transcodeChunkState: TranscodeChunkStateSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  correlationId: z.string().uuid()
});

export type VideoRecord = z.infer<typeof VideoRecordSchema>;
