import Fastify, { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { createApiErrorPayload } from "./http/api-error.js";
import { renderPipelineMetrics, summarizePipelineMetrics } from "./observability/pipeline-metrics.js";
import { renderRequestMetrics, recordRequestMetrics } from "./observability/request-metrics.js";
import { registerInternalRoutes } from "./routes/internal.js";
import { registerStorageEventRoutes } from "./routes/storage-events.js";
import { registerVideoRoutes } from "./routes/videos.js";
import { createRepositoryBundle } from "./runtime.js";
import { InMemoryQueueProducer } from "./queue/in-memory-queue-producer.js";
import { startBullMqWorkers } from "./workers/bullmq-workers.js";
import { startInMemoryWorkers } from "./workers/in-memory-workers.js";

function resolveMaxUploadBytes(): number {
  const configured = process.env.STREAM_FORGE_MAX_UPLOAD_BYTES;
  if (!configured) {
    return 512 * 1024 * 1024;
  }

  const parsed = Number.parseInt(configured, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("STREAM_FORGE_MAX_UPLOAD_BYTES must be a positive integer when set");
  }

  return parsed;
}

export async function buildServer(): Promise<FastifyInstance> {
  const maxUploadBytes = resolveMaxUploadBytes();
  const app = Fastify({ logger: true, bodyLimit: maxUploadBytes });
  await app.register(multipart, {
    limits: {
      fileSize: maxUploadBytes,
      files: 1,
      fields: 25
    }
  });
  const repositories = createRepositoryBundle(app.log);
  const shouldStartWorkers = process.env.STREAM_FORGE_START_WORKERS === "true";
  const shouldStartInMemoryWorkers = process.env.STREAM_FORGE_START_IN_MEMORY_WORKERS !== "false";
  const internalToken = process.env.STREAM_FORGE_INTERNAL_TOKEN;
  const requestStartedAt = new WeakMap<object, number>();

  if (process.env.NODE_ENV === "production" && !internalToken) {
    throw new Error("STREAM_FORGE_INTERNAL_TOKEN is required in production");
  }

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-correlation-id", request.id);
    return payload;
  });

  app.addHook("onRequest", async (request) => {
    requestStartedAt.set(request, Date.now());
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestStartedAt.get(request) ?? Date.now();
    const durationMs = Date.now() - startedAt;
    const route = request.routeOptions?.url ?? request.url;

    recordRequestMetrics({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const errorLike = typeof error === "object" && error !== null
      ? error as { statusCode?: number; message?: string }
      : {};
    const statusCode = errorLike.statusCode && errorLike.statusCode >= 400 ? errorLike.statusCode : 500;
    const message = statusCode >= 500 ? "Internal server error" : errorLike.message ?? "Request error";

    reply.status(statusCode).send(
      createApiErrorPayload(
        statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
        message,
        request.id,
        statusCode >= 500
      )
    );
  });

  if (shouldStartWorkers) {
    const redisUrl = process.env.STREAM_FORGE_REDIS_URL;
    if (!redisUrl) {
      throw new Error("STREAM_FORGE_REDIS_URL is required when STREAM_FORGE_START_WORKERS=true");
    }

    const workerRuntime = startBullMqWorkers(app.log, redisUrl, repositories);
    app.addHook("onClose", async () => {
      await workerRuntime.close();
    });
  }

  if (repositories.queueMode === "memory" && shouldStartInMemoryWorkers && repositories.queueProducer instanceof InMemoryQueueProducer) {
    const inMemoryWorkerRuntime = startInMemoryWorkers(app.log, repositories.queueProducer, repositories);
    app.addHook("onClose", async () => {
      await inMemoryWorkerRuntime.close();
    });
  }

  app.get("/health", async () => {
    return {
      ok: true,
      service: "stream-forge-api",
      authMode: repositories.authMode,
      repositoryMode: repositories.mode,
      queueMode: repositories.queueMode,
      internalTokenConfigured: Boolean(internalToken),
      workersEnabled: shouldStartWorkers,
      inMemoryWorkersEnabled: repositories.queueMode === "memory" ? shouldStartInMemoryWorkers : false
    };
  });

  app.get("/metrics", async (request, reply) => {
    if (internalToken && request.headers["x-internal-token"] !== internalToken) {
      return reply.status(401).send({ message: "Invalid internal token" });
    }

    reply.type("text/plain; version=0.0.4; charset=utf-8");
    const requestMetrics = renderRequestMetrics();
    const pipelineMetrics = renderPipelineMetrics(
      summarizePipelineMetrics(await repositories.eventRepository.listRecent(5000))
    );

    return `${requestMetrics}${pipelineMetrics}`;
  });

  await registerVideoRoutes(app, repositories);
  await registerInternalRoutes(app, repositories);
  await registerStorageEventRoutes(app, repositories);

  return app;
}
