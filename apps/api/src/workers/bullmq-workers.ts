import { Worker } from "bullmq";
import { FastifyBaseLogger } from "fastify";
import { availableParallelism } from "node:os";
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
import { QueueEnqueueRequest, QueueName } from "../queue/queue-producer.js";

type BullMqConnectionOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
};

function connectionFromRedisUrl(redisUrl: string): BullMqConnectionOptions {
  const parsed = new URL(redisUrl);
  const usesTls = parsed.protocol === "rediss:";
  const options: BullMqConnectionOptions = {
    host: parsed.hostname,
    port: Number(parsed.port || "6379"),
    db: parsed.pathname ? Number(parsed.pathname.replace("/", "") || "0") : 0
  };
  if (parsed.username) {
    options.username = parsed.username;
  }
  if (parsed.password) {
    options.password = parsed.password;
  }
  if (usesTls) {
    options.tls = {};
  }
  return options;
}

export type WorkerRuntime = {
  close(): Promise<void>;
};

function deriveJobTimingMetrics(job: {
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
}): {
  queueWaitMs?: number;
  processingMs?: number;
  totalMs?: number;
} {
  const queueWaitMs = typeof job.processedOn === "number"
    ? Math.max(0, job.processedOn - job.timestamp)
    : undefined;

  const processingMs = typeof job.processedOn === "number" && typeof job.finishedOn === "number"
    ? Math.max(0, job.finishedOn - job.processedOn)
    : undefined;

  const totalMs = typeof job.finishedOn === "number"
    ? Math.max(0, job.finishedOn - job.timestamp)
    : undefined;

  return {
    ...(typeof queueWaitMs === "number" ? { queueWaitMs } : {}),
    ...(typeof processingMs === "number" ? { processingMs } : {}),
    ...(typeof totalMs === "number" ? { totalMs } : {})
  };
}

export function startBullMqWorkers(logger: FastifyBaseLogger, redisUrl: string, deps: StageHandlerDeps): WorkerRuntime {
  const connection = connectionFromRedisUrl(redisUrl);
  const detectedCpuCount = Math.max(1, availableParallelism());

  const parsePositiveIntegerEnv = (raw: string | undefined, fallback: number): number => {
    if (!raw) {
      return fallback;
    }

    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }

    return parsed;
  };

  const defaultConcurrency = parsePositiveIntegerEnv(process.env.STREAM_FORGE_WORKER_CONCURRENCY, 1);
  const transcodeChunkConcurrency = parsePositiveIntegerEnv(
    process.env.STREAM_FORGE_TRANSCODE_CHUNK_WORKER_CONCURRENCY,
    Math.max(defaultConcurrency, Math.min(detectedCpuCount, 4))
  );
  
  // Profile-specific concurrency for cloud deployment (Option 2)
  // In cloud: each profile gets its own worker service with fixed concurrency
  // In local dev: all profiles run in one container with shared concurrency
  const profileSpecificConcurrency = 2;

  const workerConcurrencyByQueue: Record<QueueName, number> = {
    "ingest-orchestration": defaultConcurrency,
    metadata: defaultConcurrency,
    thumbnail: defaultConcurrency,
    "transcode-orchestration": defaultConcurrency,
    "transcode-chunks-processing": transcodeChunkConcurrency,
    "transcode-chunks-processing-1080p": profileSpecificConcurrency,
    "transcode-chunks-processing-720p": profileSpecificConcurrency,
    "transcode-chunks-processing-480p": profileSpecificConcurrency,
    "transcode-chunks-processing-360p": profileSpecificConcurrency,
    "transcode-reassembly": defaultConcurrency,
    transcript: defaultConcurrency,
    notification: defaultConcurrency
  };

  const parseChunkPayload = (payload: Record<string, unknown> | undefined) => {
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
        profile: profile as "1080p" | "720p" | "480p" | "360p",
        chunkIndex,
        startMs,
        endMs
      };
    }

    return null;
  };

  const createWorker = (queueName: QueueName, processor: (job: QueueEnqueueRequest) => Promise<void>) => {
    const worker = new Worker<QueueEnqueueRequest>(
      queueName,
      async (job) => processor(job.data),
      {
        connection,
        concurrency: workerConcurrencyByQueue[queueName]
      }
    );

    worker.on("completed", (job) => {
      const timing = deriveJobTimingMetrics(job);
      logger.info({
        queue: queueName,
        workerType: queueName,
        jobId: job.id,
        videoId: job.data.videoId,
        attemptCount: job.attemptsMade,
        outcome: "completed",
        ...timing
      }, "Worker job completed");
    });

    worker.on("failed", (job, error) => {
      const timing = job ? deriveJobTimingMetrics(job) : {};
      logger.error({
        queue: queueName,
        workerType: queueName,
        jobId: job?.id,
        videoId: job?.data.videoId,
        attemptCount: job?.attemptsMade,
        outcome: "failed",
        error,
        ...timing
      }, "Worker job failed");

      void (async () => {
        if (!job) {
          return;
        }

        const maxAttempts = typeof job.opts.attempts === "number" ? job.opts.attempts : 1;
        if (job.attemptsMade < maxAttempts) {
          return;
        }

        try {
          await handleProcessingFailure(deps, {
            videoId: job.data.videoId,
            stage: job.data.stage,
            correlationId: job.data.correlationId,
            errorMessage: error instanceof Error ? error.message : "Worker job failed"
          });
        } catch (failureError) {
          logger.error(
            {
              queue: queueName,
              workerType: queueName,
              jobId: job.id,
              videoId: job.data.videoId,
              attemptCount: job.attemptsMade,
              outcome: "failure_recording_failed",
              failureError
            },
            "Failed to record terminal worker failure"
          );
        }
      })();
    });

    return worker;
  };

  const workerProfile = process.env.STREAM_FORGE_WORKER_PROFILE as "1080p" | "720p" | "480p" | "360p" | undefined;
  const isProfileSpecificWorker = !!workerProfile;

  const createChunkWorker = (profile: "1080p" | "720p" | "480p" | "360p") => {
    const queueName: QueueName = `transcode-chunks-processing-${profile}` as const;
    return createWorker(queueName, async (job) => {
      const chunkPayload = parseChunkPayload(job.payload);
      if (!chunkPayload) {
        throw new Error("INVALID_CHUNK_PAYLOAD");
      }

      await handleTranscodeChunkRun(deps, {
        videoId: job.videoId,
        correlationId: job.correlationId,
        profile: chunkPayload.profile,
        chunkIndex: chunkPayload.chunkIndex,
        startMs: chunkPayload.startMs,
        endMs: chunkPayload.endMs
      });
    });
  };

  const baseWorkers = [
    createWorker("ingest-orchestration", async (job) => {
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
    }),
    createWorker("metadata", async (job) => {
      await handleMetadataRun(deps, {
        videoId: job.videoId,
        correlationId: job.correlationId
      });
    }),
    createWorker("thumbnail", async (job) => {
      await handleThumbnailRun(deps, {
        videoId: job.videoId,
        correlationId: job.correlationId
      });
    }),
    createWorker("transcode-orchestration", async (job) => {
      await handleTranscodeOrchestrationRun(deps, {
        videoId: job.videoId,
        correlationId: job.correlationId
      });
    }),
    createWorker("transcode-reassembly", async (job) => {
      await handleTranscodeReassemblyRun(deps, {
        videoId: job.videoId,
        correlationId: job.correlationId
      });
    }),
    createWorker("transcript", async (job) => {
      await handleTranscriptRun(deps, {
        videoId: job.videoId,
        correlationId: job.correlationId
      });
    }),
    createWorker("notification", async (job) => {
      await handleNotificationRun(deps, {
        videoId: job.videoId,
        correlationId: job.correlationId
      });
    })
  ];

  // Transcode chunk workers: either profile-specific (cloud) or all profiles (local dev)
  const chunkWorkers = isProfileSpecificWorker
    ? [createChunkWorker(workerProfile)]
    : [createChunkWorker("1080p"), createChunkWorker("720p"), createChunkWorker("480p"), createChunkWorker("360p")];

  const workers = [...baseWorkers, ...chunkWorkers];

  logger.info({
    queues: workers.length,
    detectedCpuCount,
    workerProfile: workerProfile || "all (local dev)",
    workerConcurrencyByQueue
  }, "BullMQ workers started");

  return {
    async close(): Promise<void> {
      await Promise.all(workers.map((worker) => worker.close()));
    }
  };
}
