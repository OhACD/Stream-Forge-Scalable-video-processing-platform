import { FastifyBaseLogger } from "fastify";
import {
  handleMetadataRun,
  handleNotificationRun,
  handleProcessingFailure,
  handleThumbnailRun,
  handleTranscriptRun,
  handleTranscodeChunkRun,
  handleTranscodeOrchestrationRun,
  handleTranscodeReassemblyRun,
  handleUploadCompleted,
  StageHandlerDeps
} from "../processing/stage-handlers.js";
import { MemoryQueueJob, InMemoryQueueProducer } from "../queue/in-memory-queue-producer.js";

export type InMemoryWorkerRuntime = {
  close(): Promise<void>;
};

function parseChunkPayload(payload: Record<string, unknown> | undefined): {
  profile: "1080p" | "720p" | "480p" | "360p";
  chunkIndex: number;
  startMs: number;
  endMs: number;
} | null {
  const profile = payload?.profile;
  const chunkIndex = payload?.chunkIndex;
  const startMs = payload?.startMs;
  const endMs = payload?.endMs;

  if (
    (profile === "1080p" || profile === "720p" || profile === "480p" || profile === "360p") &&
    typeof chunkIndex === "number" && Number.isFinite(chunkIndex) &&
    typeof startMs === "number" && Number.isFinite(startMs) &&
    typeof endMs === "number" && Number.isFinite(endMs)
  ) {
    return {
      profile,
      chunkIndex,
      startMs,
      endMs
    };
  }

  return null;
}

async function processJob(logger: FastifyBaseLogger, deps: StageHandlerDeps, job: MemoryQueueJob): Promise<void> {
  switch (job.queue) {
    case "ingest-orchestration": {
      const sourceObjectPath = typeof job.payload?.sourceObjectPath === "string"
        ? job.payload.sourceObjectPath
        : typeof job.payload?.uploadPath === "string"
          ? job.payload.uploadPath
          : `tenants/${job.tenantId}/videos/${job.videoId}/source/upload.bin`;

      await handleUploadCompleted(deps, {
        videoId: job.videoId,
        tenantId: job.tenantId,
        objectPath: sourceObjectPath,
        correlationId: job.correlationId,
        ...(job.causationEventId ? { eventId: job.causationEventId } : {})
      });
      return;
    }
    case "metadata":
      await handleMetadataRun(deps, {
        videoId: job.videoId,
        correlationId: job.correlationId
      });
      return;
    case "thumbnail":
      await handleThumbnailRun(deps, {
        videoId: job.videoId,
        correlationId: job.correlationId
      });
      return;
    case "transcode-orchestration":
      await handleTranscodeOrchestrationRun(deps, {
        videoId: job.videoId,
        correlationId: job.correlationId
      });
      return;
    case "transcode-chunks-processing":
    case "transcode-chunks-processing-1080p":
    case "transcode-chunks-processing-720p":
    case "transcode-chunks-processing-480p":
    case "transcode-chunks-processing-360p": {
      const chunk = parseChunkPayload(job.payload);
      if (!chunk) {
        throw new Error("INVALID_CHUNK_PAYLOAD");
      }

      await handleTranscodeChunkRun(deps, {
        videoId: job.videoId,
        correlationId: job.correlationId,
        profile: chunk.profile,
        chunkIndex: chunk.chunkIndex,
        startMs: chunk.startMs,
        endMs: chunk.endMs
      });
      return;
    }
    case "transcode-reassembly":
      await handleTranscodeReassemblyRun(deps, {
        videoId: job.videoId,
        correlationId: job.correlationId
      });
      return;
    case "transcript":
      await handleTranscriptRun(deps, {
        videoId: job.videoId,
        correlationId: job.correlationId
      });
      return;
    case "notification":
      await handleNotificationRun(deps, {
        videoId: job.videoId,
        correlationId: job.correlationId
      });
      return;
  }
}

export function startInMemoryWorkers(
  logger: FastifyBaseLogger,
  queueProducer: InMemoryQueueProducer,
  deps: StageHandlerDeps
): InMemoryWorkerRuntime {
  let stopped = false;
  let running = false;

  const tick = async (): Promise<void> => {
    if (stopped || running) {
      return;
    }

    running = true;
    try {
      for (;;) {
        const job = queueProducer.dequeueNext();
        if (!job) {
          break;
        }

        try {
          await processJob(logger, deps, job);
          logger.info({ queue: job.queue, jobId: job.jobId, videoId: job.videoId, outcome: "completed" }, "In-memory worker job completed");
        } catch (error) {
          logger.error({ queue: job.queue, jobId: job.jobId, videoId: job.videoId, outcome: "failed", error }, "In-memory worker job failed");
          try {
            await handleProcessingFailure(deps, {
              videoId: job.videoId,
              stage: job.stage,
              correlationId: job.correlationId,
              errorMessage: error instanceof Error ? error.message : "In-memory worker job failed"
            });
          } catch (failureError) {
            logger.error({ queue: job.queue, jobId: job.jobId, videoId: job.videoId, failureError }, "Failed to mark processing failure from in-memory worker");
          }
        }
      }
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, 20);

  logger.info("In-memory workers started");

  return {
    async close(): Promise<void> {
      stopped = true;
      clearInterval(timer);
    }
  };
}
