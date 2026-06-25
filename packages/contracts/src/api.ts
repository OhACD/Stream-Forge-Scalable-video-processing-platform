import { z } from "zod";
import { VideoLifecycleStatusSchema, VideoRecordSchema, VideoStageSchema } from "./video.js";

export const CreateVideoRequestSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  tenantId: z.string().min(1),
  checksumSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional()
});

export type CreateVideoRequest = z.infer<typeof CreateVideoRequestSchema>;

export const CreateVideoResponseSchema = z.object({
  videoId: z.string().min(1),
  uploadPath: z.string().min(1),
  status: VideoLifecycleStatusSchema,
  correlationId: z.string().uuid(),
  expiresAt: z.string().datetime()
});

export type CreateVideoResponse = z.infer<typeof CreateVideoResponseSchema>;

export const UploadVideoResponseSchema = z.object({
  videoId: z.string().min(1),
  status: VideoLifecycleStatusSchema,
  activeStage: VideoStageSchema.optional(),
  progressPercent: z.number().int().min(0).max(100),
  uploadedBytes: z.number().int().nonnegative(),
  uploadedChecksumSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  correlationId: z.string().uuid(),
  queuedAt: z.string().datetime()
});

export type UploadVideoResponse = z.infer<typeof UploadVideoResponseSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    correlationId: z.string().min(1),
    retryable: z.boolean()
  })
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export const VideoStatusResponseSchema = z.object({
  videoId: z.string().min(1),
  status: VideoLifecycleStatusSchema,
  activeStage: VideoStageSchema.optional(),
  progressPercent: z.number().int().min(0).max(100),
  updatedAt: z.string().datetime(),
  correlationId: z.string().uuid()
});

export type VideoStatusResponse = z.infer<typeof VideoStatusResponseSchema>;

export const VideoAssetsResponseSchema = z.object({
  sourceUrl: z.string().url(),
  thumbnailUrls: z.array(
    z.object({
      type: z.enum(["poster", "timeline"]),
      url: z.string().url(),
      objectPath: z.string().min(1)
    })
  ),
  variantUrls: z.array(
    z.object({
      profile: z.enum(["1080p", "720p", "480p", "360p"]),
      url: z.string().url(),
      objectPath: z.string().min(1)
    })
  )
});

export type VideoAssetsResponse = z.infer<typeof VideoAssetsResponseSchema>;

export const VideoDetailsResponseSchema = VideoRecordSchema.extend({
  assets: VideoAssetsResponseSchema.optional()
});
export type VideoDetailsResponse = z.infer<typeof VideoDetailsResponseSchema>;

export const VideoListItemSchema = z.object({
  videoId: z.string().min(1),
  status: VideoLifecycleStatusSchema,
  activeStage: VideoStageSchema.optional(),
  progressPercent: z.number().int().min(0).max(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  correlationId: z.string().uuid()
});

export type VideoListItem = z.infer<typeof VideoListItemSchema>;

export const ListVideosResponseSchema = z.object({
  items: z.array(VideoListItemSchema),
  nextPageToken: z.string().optional()
});

export type ListVideosResponse = z.infer<typeof ListVideosResponseSchema>;

export const RetryVideoRequestSchema = z.object({
  stage: z.enum([
    "metadata",
    "thumbnail",
    "transcode-orchestration",
    "transcode-chunks-processing",
    "transcode-reassembly",
    "transcript",
    "notification"
  ]).default("transcode-orchestration")
});

export type RetryVideoRequest = z.infer<typeof RetryVideoRequestSchema>;

export const RetryVideoResponseSchema = z.object({
  videoId: z.string().min(1),
  status: VideoLifecycleStatusSchema,
  activeStage: VideoStageSchema.optional(),
  progressPercent: z.number().int().min(0).max(100),
  updatedAt: z.string().datetime(),
  correlationId: z.string().uuid()
});

export type RetryVideoResponse = z.infer<typeof RetryVideoResponseSchema>;

export const DeleteVideoResponseSchema = z.object({
  videoId: z.string().min(1),
  status: z.literal("deleted"),
  deletedAt: z.string().datetime(),
  correlationId: z.string().uuid()
});

export type DeleteVideoResponse = z.infer<typeof DeleteVideoResponseSchema>;
