import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { Authenticator } from "../auth/authenticator.js";
import { ThumbnailAssetSchema, TranscodeVariantSchema, VideoMetadataSchema, VideoLifecycleStatus } from "@stream-forge/contracts";
import {
  defaultMetadata,
  defaultThumbnails,
  defaultVariants,
  handleMetadataRun,
  handleNotificationRun,
  handleProcessingFailure,
  handleThumbnailRun,
  handleTranscodeRun,
  handleUploadCompleted,
  StageHandlerDeps
} from "../processing/stage-handlers.js";
import { z } from "zod";
import { queueFromStage } from "../queue/stage-queue.js";
import { createApiErrorPayload } from "../http/api-error.js";
import { summarizePipelineMetrics } from "../observability/pipeline-metrics.js";

type InternalRouteDeps = StageHandlerDeps;

type InternalRouteAuthDeps = InternalRouteDeps & {
  authenticator: Authenticator;
};

const UploadCompletedCommandSchema = z.object({
  videoId: z.string().min(1),
  tenantId: z.string().min(1),
  objectPath: z.string().min(1),
  correlationId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional()
});

const MetadataWorkerRunSchema = z.object({
  videoId: z.string().min(1),
  correlationId: z.string().uuid().optional(),
  metadataOverride: VideoMetadataSchema.optional()
});

const ThumbnailWorkerRunSchema = z.object({
  videoId: z.string().min(1),
  correlationId: z.string().uuid().optional(),
  thumbnailsOverride: z.array(ThumbnailAssetSchema).optional()
});

const TranscodeWorkerRunSchema = z.object({
  videoId: z.string().min(1),
  correlationId: z.string().uuid().optional(),
  variantsOverride: z.array(TranscodeVariantSchema).optional()
});

const NotificationWorkerRunSchema = z.object({
  videoId: z.string().min(1),
  correlationId: z.string().uuid().optional()
});

const FailureWorkerRunSchema = z.object({
  videoId: z.string().min(1),
  stage: z.enum([
    "metadata",
    "thumbnail",
    "transcode-orchestration",
    "transcode-chunks-processing",
    "transcode-reassembly",
    "transcript",
    "notification"
  ]),
  errorMessage: z.string().min(1),
  correlationId: z.string().uuid().optional()
});

const DlqReplaySchema = z.object({
  videoId: z.string().min(1),
  stage: z.enum([
    "metadata",
    "thumbnail",
    "transcode-orchestration",
    "transcode-chunks-processing",
    "transcode-reassembly",
    "transcript",
    "notification"
  ]).optional(),
  correlationId: z.string().uuid().optional()
});

const InternalQueueMetricsSchema = z.object({
  queue: z.enum([
    "ingest-orchestration",
    "metadata",
    "thumbnail",
    "transcode-orchestration",
    "transcode-chunks-processing",
    "transcode-chunks-processing-1080p",
    "transcode-chunks-processing-720p",
    "transcode-chunks-processing-480p",
    "transcode-chunks-processing-360p",
    "transcode-reassembly",
    "transcript",
    "notification"
  ]),
  waiting: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  delayed: z.number().int().nonnegative(),
  paused: z.number().int().nonnegative(),
  total: z.number().int().nonnegative()
});

function countVideosByStatus(videos: Awaited<ReturnType<InternalRouteDeps["videoRepository"]["listAll"]>>) {
  const counts: Record<VideoLifecycleStatus, number> = {
    queued: 0,
    processing: 0,
    partially_complete: 0,
    ready: 0,
    failed: 0,
    deleted: 0
  };

  for (const video of videos) {
    counts[video.status] += 1;
  }

  return counts;
}

function hasInternalAccess(tokenHeader: unknown): boolean {
  const configuredToken = process.env.STREAM_FORGE_INTERNAL_TOKEN;
  if (!configuredToken) {
    return process.env.NODE_ENV !== "production";
  }

  return typeof tokenHeader === "string" && tokenHeader === configuredToken;
}

async function requireOperatorOrAdmin(
  deps: InternalRouteAuthDeps,
  headers: Record<string, unknown>
): Promise<{ userId: string; role: string } | null> {
  const principal = await deps.authenticator.authenticate(headers);
  if (!principal) {
    return null;
  }

  const role = principal.role;
  if (role !== "operator" && role !== "admin") {
    return null;
  }

  return {
    userId: principal.userId,
    role
  };
}

export async function registerInternalRoutes(app: FastifyInstance, deps: InternalRouteAuthDeps): Promise<void> {
  app.post<{ Body: unknown }>("/internal/events/upload-completed", async (request, reply) => {
    if (!hasInternalAccess(request.headers["x-internal-token"])) {
      return reply.status(401).send({ message: "Invalid internal token" });
    }

    const actor = await requireOperatorOrAdmin(deps, request.headers as Record<string, unknown>);
    if (!actor) {
      return reply.status(403).send(createApiErrorPayload("FORBIDDEN", "Operator or admin role required for manual upload-completed execution", request.id));
    }

    const parsed = UploadCompletedCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid request body", issues: parsed.error.issues });
    }

    try {
      const result = await handleUploadCompleted(deps, {
        videoId: parsed.data.videoId,
        tenantId: parsed.data.tenantId,
        objectPath: parsed.data.objectPath,
        ...(parsed.data.correlationId ? { correlationId: parsed.data.correlationId } : {}),
        ...(parsed.data.eventId ? { eventId: parsed.data.eventId } : {})
      });
      return reply.status(202).send(result);
    } catch (error) {
      if (error instanceof Error && error.message === "VIDEO_NOT_FOUND") {
        return reply.status(404).send({ message: "Video not found" });
      }

      throw error;
    }
  });

  app.post<{ Body: unknown }>("/internal/workers/failure/run-once", async (request, reply) => {
    if (!hasInternalAccess(request.headers["x-internal-token"])) {
      return reply.status(401).send({ message: "Invalid internal token" });
    }

    const actor = await requireOperatorOrAdmin(deps, request.headers as Record<string, unknown>);
    if (!actor) {
      return reply.status(403).send(createApiErrorPayload("FORBIDDEN", "Operator or admin role required for manual failure execution", request.id));
    }

    const parsed = FailureWorkerRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid request body", issues: parsed.error.issues });
    }

    try {
      const result = await handleProcessingFailure(deps, {
        videoId: parsed.data.videoId,
        stage: parsed.data.stage,
        errorMessage: parsed.data.errorMessage,
        ...(parsed.data.correlationId ? { correlationId: parsed.data.correlationId } : {})
      });
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof Error && error.message === "VIDEO_NOT_FOUND") {
        return reply.status(404).send({ message: "Video not found" });
      }
      if (error instanceof Error && error.message === "INVALID_STAGE_STATE") {
        return reply.status(409).send({ message: "Video is not in a processing state that can be marked failed" });
      }

      throw error;
    }
  });

  app.post<{ Body: unknown }>("/internal/workers/metadata/run-once", async (request, reply) => {
    if (!hasInternalAccess(request.headers["x-internal-token"])) {
      return reply.status(401).send({ message: "Invalid internal token" });
    }

    const actor = await requireOperatorOrAdmin(deps, request.headers as Record<string, unknown>);
    if (!actor) {
      return reply.status(403).send(createApiErrorPayload("FORBIDDEN", "Operator or admin role required for manual metadata execution", request.id));
    }

    const parsed = MetadataWorkerRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid request body", issues: parsed.error.issues });
    }

    try {
      const result = await handleMetadataRun(deps, {
        videoId: parsed.data.videoId,
        ...(parsed.data.correlationId ? { correlationId: parsed.data.correlationId } : {}),
        metadataOverride: parsed.data.metadataOverride ?? defaultMetadata()
      });
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof Error && error.message === "VIDEO_NOT_FOUND") {
        return reply.status(404).send({ message: "Video not found" });
      }
      if (error instanceof Error && error.message === "INVALID_STAGE_STATE") {
        return reply.status(409).send({ message: "Video is not ready for metadata processing" });
      }

      throw error;
    }
  });

  app.post<{ Body: unknown }>("/internal/workers/thumbnail/run-once", async (request, reply) => {
    if (!hasInternalAccess(request.headers["x-internal-token"])) {
      return reply.status(401).send({ message: "Invalid internal token" });
    }

    const actor = await requireOperatorOrAdmin(deps, request.headers as Record<string, unknown>);
    if (!actor) {
      return reply.status(403).send(createApiErrorPayload("FORBIDDEN", "Operator or admin role required for manual thumbnail execution", request.id));
    }

    const parsed = ThumbnailWorkerRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid request body", issues: parsed.error.issues });
    }

    try {
      const existing = await deps.videoRepository.findById(parsed.data.videoId);
      const result = await handleThumbnailRun(deps, {
        videoId: parsed.data.videoId,
        ...(parsed.data.correlationId ? { correlationId: parsed.data.correlationId } : {}),
        ...((parsed.data.thumbnailsOverride ?? (existing ? defaultThumbnails(existing.videoId, existing.tenantId) : undefined))
          ? { thumbnailsOverride: parsed.data.thumbnailsOverride ?? defaultThumbnails(existing!.videoId, existing!.tenantId) }
          : {})
      });
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof Error && error.message === "VIDEO_NOT_FOUND") {
        return reply.status(404).send({ message: "Video not found" });
      }
      if (error instanceof Error && error.message === "INVALID_STAGE_STATE") {
        return reply.status(409).send({ message: "Video is not ready for thumbnail processing" });
      }

      throw error;
    }
  });

  app.post<{ Body: unknown }>("/internal/workers/transcode/run-once", async (request, reply) => {
    if (!hasInternalAccess(request.headers["x-internal-token"])) {
      return reply.status(401).send({ message: "Invalid internal token" });
    }

    const actor = await requireOperatorOrAdmin(deps, request.headers as Record<string, unknown>);
    if (!actor) {
      return reply.status(403).send(createApiErrorPayload("FORBIDDEN", "Operator or admin role required for manual transcode execution", request.id));
    }

    const parsed = TranscodeWorkerRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid request body", issues: parsed.error.issues });
    }

    try {
      const existing = await deps.videoRepository.findById(parsed.data.videoId);
      const result = await handleTranscodeRun(deps, {
        videoId: parsed.data.videoId,
        ...(parsed.data.correlationId ? { correlationId: parsed.data.correlationId } : {}),
        ...((parsed.data.variantsOverride ?? (existing ? defaultVariants(existing.videoId, existing.tenantId) : undefined))
          ? { variantsOverride: parsed.data.variantsOverride ?? defaultVariants(existing!.videoId, existing!.tenantId) }
          : {})
      });
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof Error && error.message === "VIDEO_NOT_FOUND") {
        return reply.status(404).send({ message: "Video not found" });
      }
      if (error instanceof Error && error.message === "INVALID_STAGE_STATE") {
        return reply.status(409).send({ message: "Video is not ready for transcode processing" });
      }

      throw error;
    }
  });

  app.post<{ Body: unknown }>("/internal/workers/notification/run-once", async (request, reply) => {
    if (!hasInternalAccess(request.headers["x-internal-token"])) {
      return reply.status(401).send({ message: "Invalid internal token" });
    }

    const actor = await requireOperatorOrAdmin(deps, request.headers as Record<string, unknown>);
    if (!actor) {
      return reply.status(403).send(createApiErrorPayload("FORBIDDEN", "Operator or admin role required for manual notification execution", request.id));
    }

    const parsed = NotificationWorkerRunSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid request body", issues: parsed.error.issues });
    }

    try {
      const result = await handleNotificationRun(deps, {
        videoId: parsed.data.videoId,
        ...(parsed.data.correlationId ? { correlationId: parsed.data.correlationId } : {})
      });
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof Error && error.message === "VIDEO_NOT_FOUND") {
        return reply.status(404).send({ message: "Video not found" });
      }
      if (error instanceof Error && error.message === "INVALID_STAGE_STATE") {
        return reply.status(409).send({ message: "Video is not ready for notification processing" });
      }

      throw error;
    }
  });

  app.post<{ Body: unknown }>("/internal/dlq/replay", async (request, reply) => {
    if (!hasInternalAccess(request.headers["x-internal-token"])) {
      return reply.status(401).send({ message: "Invalid internal token" });
    }

    const actor = await requireOperatorOrAdmin(deps, request.headers as Record<string, unknown>);
    if (!actor) {
      return reply.status(403).send(createApiErrorPayload("FORBIDDEN", "Operator or admin role required for DLQ replay", request.id));
    }

    const parsed = DlqReplaySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid request body", issues: parsed.error.issues });
    }

    const video = await deps.videoRepository.findById(parsed.data.videoId);
    if (!video) {
      return reply.status(404).send(createApiErrorPayload("VIDEO_NOT_FOUND", "The requested video does not exist.", request.id));
    }

    if (video.status !== "failed") {
      return reply.status(409).send(createApiErrorPayload("INVALID_STATE_TRANSITION", "Video must be in failed status to replay from the DLQ.", request.id));
    }

    const stage = parsed.data.stage ?? video.activeStage;
    if (!stage) {
      return reply.status(409).send(createApiErrorPayload("INVALID_STATE_TRANSITION", "Video does not have a replayable stage.", request.id));
    }

    const correlationId = parsed.data.correlationId ?? video.correlationId;

    try {
      const replayed = await deps.videoRepository.transitionStatus({
        videoId: video.videoId,
        toStatus: "processing",
        activeStage: stage,
        progressPercent: 10,
        correlationId,
        requireCurrentStatus: "failed"
      });

      if (!replayed) {
        return reply.status(404).send(createApiErrorPayload("VIDEO_NOT_FOUND", "The requested video does not exist.", request.id));
      }

      const retryEventId = randomUUID();
      await deps.eventRepository.append({
        eventId: retryEventId,
        eventType: "RetryRequested",
        videoId: replayed.videoId,
        tenantId: replayed.tenantId,
        stage,
        correlationId,
        occurredAt: new Date().toISOString(),
        payload: {
          reason: "dlq_replay",
          replayRequestedBy: actor.userId,
          replayRequesterRole: actor.role
        }
      });

      const jobId = await deps.queueProducer.enqueue({
        queue: queueFromStage(stage),
        videoId: replayed.videoId,
        tenantId: replayed.tenantId,
        stage,
        correlationId,
        causationEventId: retryEventId,
        payload: {
          reason: "dlq_replay"
        }
      });

      return reply.status(202).send({
        accepted: true,
        videoId: replayed.videoId,
        stage,
        correlationId,
        jobId
      });
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_STAGE_STATE") {
        return reply.status(409).send(createApiErrorPayload("INVALID_STATE_TRANSITION", "Video is not in a replayable state.", request.id));
      }

      throw error;
    }
  });

  app.get("/internal/metrics", async (request, reply) => {
    if (!hasInternalAccess(request.headers["x-internal-token"])) {
      return reply.status(401).send({ message: "Invalid internal token" });
    }

    const actor = await requireOperatorOrAdmin(deps, request.headers as Record<string, unknown>);
    if (!actor) {
      return reply.status(403).send(createApiErrorPayload("FORBIDDEN", "Operator or admin role required for internal metrics", request.id));
    }

    const videos = await deps.videoRepository.listAll();
    const counts = countVideosByStatus(videos);
    const queueMetrics = (await deps.queueProducer.getMetrics()).map((metric) => InternalQueueMetricsSchema.parse(metric));
    const pipeline = summarizePipelineMetrics(await deps.eventRepository.listRecent(5000));

    return reply.status(200).send({
      repositoryMode: "video-counts",
      counts,
      totalVideos: videos.length,
      queues: queueMetrics,
      pipeline,
      generatedAt: new Date().toISOString()
    });
  });
}
