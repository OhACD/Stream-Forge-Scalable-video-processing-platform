import { z } from "zod";
import { VideoStageSchema } from "./video.js";

export const EventTypeSchema = z.enum([
  "VideoUploadRequested",
  "RetryRequested",
  "UploadCompleted",
  "StageStarted",
  "MetadataExtracted",
  "ThumbnailGenerated",
  "TranscodeChunksEnqueued",
  "TranscodingCompleted",
  "TranscriptGenerated",
  "VideoReady",
  "ProcessingFailed"
]);

export type EventType = z.infer<typeof EventTypeSchema>;

export const DomainEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: EventTypeSchema,
  videoId: z.string().min(1),
  tenantId: z.string().min(1),
  stage: VideoStageSchema,
  correlationId: z.string().uuid(),
  causationId: z.string().uuid().optional(),
  occurredAt: z.string().datetime(),
  payload: z.record(z.unknown())
});

export type DomainEvent = z.infer<typeof DomainEventSchema>;
