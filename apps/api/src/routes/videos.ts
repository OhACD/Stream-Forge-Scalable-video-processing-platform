import { createHash, createHmac, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { FastifyInstance, FastifyReply } from "fastify";
import {
  DeleteVideoResponse,
  CreateVideoRequestSchema,
  CreateVideoResponse,
  DomainEvent,
  ListVideosResponse,
  RetryVideoRequestSchema,
  RetryVideoResponse,
  UploadVideoResponse,
  VideoDetailsResponse,
  VideoStatusResponse
} from "@stream-forge/contracts";
import { createApiErrorPayload } from "../http/api-error.js";
import { EventRepository } from "../repository/event-repository.js";
import { AssetUrlSigner } from "../assets/asset-url-signer.js";
import { Authenticator } from "../auth/authenticator.js";
import { QueueProducer } from "../queue/queue-producer.js";
import { queueFromStage } from "../queue/stage-queue.js";
import { IdempotencyRepository } from "../repository/idempotency-repository.js";
import { VideoRepository } from "../repository/video-repository.js";
import { handleUploadCompleted } from "../processing/stage-handlers.js";
import { resolveLocalObjectPath, writeLocalObjectFromChunks } from "../storage/local-object-storage.js";

type VideoRouteDeps = {
  videoRepository: VideoRepository;
  eventRepository: EventRepository;
  idempotencyRepository: IdempotencyRepository;
  queueProducer: QueueProducer;
  assetUrlSigner: AssetUrlSigner;
  authenticator: Authenticator;
};

async function requirePrincipal(deps: VideoRouteDeps, headers: Record<string, unknown>) {
  const principal = await deps.authenticator.authenticate(headers);
  if (!principal) {
    return null;
  }

  return principal;
}

function decodePageToken(pageToken?: string): number {
  if (!pageToken) {
    return 0;
  }

  const parsed = JSON.parse(Buffer.from(pageToken, "base64url").toString("utf8")) as { offset?: number };
  if (typeof parsed.offset !== "number" || parsed.offset < 0) {
    throw new Error("INVALID_PAGE_TOKEN");
  }

  return parsed.offset;
}

function encodePageToken(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

async function toVideoDetailsResponse(video: Awaited<ReturnType<VideoRepository["findById"]>>, signer: AssetUrlSigner): Promise<VideoDetailsResponse> {
  if (!video) {
    throw new Error("Cannot shape null video");
  }

  const assets = {
    sourceUrl: await signer.signObjectPath({ objectPath: video.objectPath, expiresInSeconds: 300 }),
    thumbnailUrls: await Promise.all((video.thumbnails ?? []).map(async (thumbnail) => ({
      type: thumbnail.type,
      objectPath: thumbnail.objectPath,
      url: await signer.signObjectPath({ objectPath: thumbnail.objectPath, expiresInSeconds: 300 })
    }))),
    variantUrls: await Promise.all((video.variants ?? []).map(async (variant) => ({
      profile: variant.profile,
      objectPath: variant.objectPath,
      url: await signer.signObjectPath({ objectPath: variant.objectPath, expiresInSeconds: 300 })
    })))
  };

  return {
    ...video,
    assets
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveMediaContentType(objectPath: string): string {
  const extension = extname(objectPath).toLowerCase();

  switch (extension) {
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".m3u8":
      return "application/vnd.apple.mpegurl";
    case ".ts":
      return "video/mp2t";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".vtt":
      return "text/vtt; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function signedAssetSecret(): string {
  return process.env.STREAM_FORGE_ASSET_SIGNING_SECRET ?? "dev-only-secret";
}

function parseSingleQueryValue(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return null;
}

function safeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return result === 0;
}

function parseRangeHeader(rangeHeader: string, totalSize: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }

  const rawStart = match[1] ?? "";
  const rawEnd = match[2] ?? "";

  if (!rawStart && !rawEnd) {
    return null;
  }

  if (!rawStart) {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }

    const start = Math.max(totalSize - suffixLength, 0);
    return { start, end: totalSize - 1 };
  }

  const start = Number.parseInt(rawStart, 10);
  if (!Number.isFinite(start) || start < 0 || start >= totalSize) {
    return null;
  }

  if (!rawEnd) {
    return { start, end: totalSize - 1 };
  }

  const end = Number.parseInt(rawEnd, 10);
  if (!Number.isFinite(end) || end < start) {
    return null;
  }

  return { start, end: Math.min(end, totalSize - 1) };
}

function idempotencyKeyFromHeaders(headers: Record<string, unknown>): string | null {
  const raw = headers["idempotency-key"];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

async function maybeReplayIdempotentResponse(
  deps: VideoRouteDeps,
  scope: string,
  key: string,
  reply: FastifyReply
): Promise<boolean> {
  const existing = await deps.idempotencyRepository.get(scope, key);
  if (!existing) {
    return false;
  }

  reply.status(existing.statusCode).send(existing.responseBody);
  return true;
}

async function storeIdempotentResponse(
  deps: VideoRouteDeps,
  scope: string,
  key: string,
  statusCode: number,
  responseBody: unknown
): Promise<void> {
  await deps.idempotencyRepository.put({
    scope,
    key,
    statusCode,
    responseBody,
    createdAt: nowIso()
  });
}

export async function registerVideoRoutes(app: FastifyInstance, deps: VideoRouteDeps): Promise<void> {
  app.get<{ Querystring: { path?: string; exp?: string; sig?: string } }>("/assets/signed", async (request, reply) => {
    const objectPath = parseSingleQueryValue(request.query.path);
    const exp = parseSingleQueryValue(request.query.exp);
    const signature = parseSingleQueryValue(request.query.sig);

    if (!objectPath || !exp || !signature) {
      return reply.status(400).send(createApiErrorPayload("VALIDATION_ERROR", "Missing path, exp, or sig query parameter", request.id));
    }

    const expEpoch = Number.parseInt(exp, 10);
    if (!Number.isFinite(expEpoch)) {
      return reply.status(400).send(createApiErrorPayload("VALIDATION_ERROR", "Invalid exp query parameter", request.id));
    }

    if (Math.floor(Date.now() / 1000) > expEpoch) {
      return reply.status(403).send(createApiErrorPayload("REQUEST_ERROR", "Signed asset URL expired", request.id, false));
    }

    const payload = `${objectPath}:${expEpoch}`;
    const expectedSignature = createHmac("sha256", signedAssetSecret()).update(payload).digest("hex");

    if (!safeHexEqual(signature, expectedSignature)) {
      return reply.status(403).send(createApiErrorPayload("REQUEST_ERROR", "Invalid signed asset URL", request.id, false));
    }

    let absolutePath: string;
    try {
      absolutePath = resolveLocalObjectPath(objectPath);
    } catch {
      return reply.status(400).send(createApiErrorPayload("VALIDATION_ERROR", "Invalid object path", request.id));
    }

    let fileSize = 0;
    try {
      const fileStats = await stat(absolutePath);
      fileSize = fileStats.size;
    } catch {
      return reply.status(404).send(createApiErrorPayload("VIDEO_NOT_FOUND", "Asset file not found", request.id));
    }

    const rangeHeader = typeof request.headers.range === "string" ? request.headers.range : null;
    const resolvedRange = rangeHeader ? parseRangeHeader(rangeHeader, fileSize) : null;

    reply.header("cache-control", "private, max-age=60");
    reply.header("accept-ranges", "bytes");
    reply.type(resolveMediaContentType(objectPath));

    if (resolvedRange) {
      const { start, end } = resolvedRange;
      reply.code(206);
      reply.header("content-range", `bytes ${start}-${end}/${fileSize}`);
      reply.header("content-length", String(end - start + 1));
      return reply.send(createReadStream(absolutePath, { start, end }));
    }

    reply.header("content-length", String(fileSize));
    return reply.send(createReadStream(absolutePath));
  });

  app.post<{ Body: unknown }>("/videos", async (request, reply) => {
    const principal = await requirePrincipal(deps, request.headers as Record<string, unknown>);
    if (!principal) {
      return reply.status(401).send(createApiErrorPayload("AUTH_REQUIRED", "Authentication required", request.id));
    }

    const parsed = CreateVideoRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(createApiErrorPayload("VALIDATION_ERROR", "Invalid request body", request.id));
    }

    const idempotencyKey = idempotencyKeyFromHeaders(request.headers as Record<string, unknown>);
    const createScope = `create-video:${principal.userId}`;
    if (idempotencyKey && await maybeReplayIdempotentResponse(deps, createScope, idempotencyKey, reply)) {
      return;
    }

    const videoId = randomUUID();
    const correlationId = randomUUID();
    const uploadPath = `tenants/${parsed.data.tenantId}/videos/${videoId}/source/${parsed.data.filename}`;
    const timestamp = nowIso();

    await deps.videoRepository.create({
      videoId,
      ownerUserId: principal.userId,
      tenantId: parsed.data.tenantId,
      objectPath: uploadPath,
      declaredContentType: parsed.data.contentType,
      declaredSizeBytes: parsed.data.sizeBytes,
      sourceChecksumSha256: parsed.data.checksumSha256,
      status: "queued",
      activeStage: "upload",
      progressPercent: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      correlationId
    });

    const uploadRequestedEvent: DomainEvent = {
      eventId: randomUUID(),
      eventType: "VideoUploadRequested",
      videoId,
      tenantId: parsed.data.tenantId,
      stage: "upload",
      correlationId,
      occurredAt: nowIso(),
      payload: {
        filename: parsed.data.filename,
        contentType: parsed.data.contentType,
        sizeBytes: parsed.data.sizeBytes,
        checksumSha256: parsed.data.checksumSha256,
        uploadPath
      }
    };

    await deps.eventRepository.append(uploadRequestedEvent);

    const response: CreateVideoResponse = {
      videoId,
      uploadPath,
      status: "queued",
      correlationId,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };

    if (idempotencyKey) {
      await storeIdempotentResponse(deps, createScope, idempotencyKey, 201, response);
    }

    return reply.status(201).send(response);
  });

  app.post<{ Params: { videoId: string } }>("/videos/:videoId/upload", async (request, reply) => {
    const principal = await requirePrincipal(deps, request.headers as Record<string, unknown>);
    if (!principal) {
      return reply.status(401).send(createApiErrorPayload("AUTH_REQUIRED", "Authentication required", request.id));
    }

    const video = await deps.videoRepository.findById(request.params.videoId);
    if (!video || video.ownerUserId !== principal.userId) {
      return reply.status(404).send(createApiErrorPayload("VIDEO_NOT_FOUND", "The requested video does not exist or is not accessible.", request.id));
    }

    if (video.status !== "queued" || video.activeStage !== "upload") {
      return reply.status(409).send(createApiErrorPayload("INVALID_STATE_TRANSITION", "Video is no longer waiting for upload", request.id));
    }

    const filePart = await request.file();
    if (!filePart) {
      return reply.status(400).send(createApiErrorPayload("VALIDATION_ERROR", "A file field named 'file' is required", request.id));
    }

    let uploadedBytes = 0;
    const checksumHasher = createHash("sha256");

    await writeLocalObjectFromChunks(video.objectPath, (async function* () {
      for await (const chunk of filePart.file) {
        uploadedBytes += chunk.length;
        checksumHasher.update(chunk);
        yield chunk;
      }
    })());

    const uploadedChecksumSha256 = `sha256:${checksumHasher.digest("hex")}`;

    if (video.declaredSizeBytes && uploadedBytes !== video.declaredSizeBytes) {
      return reply.status(400).send(createApiErrorPayload("UPLOAD_SIZE_MISMATCH", "Uploaded file size does not match declared size", request.id));
    }

    if (video.declaredContentType && typeof filePart.mimetype === "string") {
      const expected = video.declaredContentType.toLowerCase();
      const actual = filePart.mimetype.toLowerCase();
      if (expected !== actual) {
        return reply.status(400).send(createApiErrorPayload("UPLOAD_CONTENT_TYPE_MISMATCH", "Uploaded file content type does not match declared content type", request.id));
      }
    }

    if (video.sourceChecksumSha256 && uploadedChecksumSha256 !== video.sourceChecksumSha256.toLowerCase()) {
      return reply.status(400).send(createApiErrorPayload("UPLOAD_CHECKSUM_MISMATCH", "Uploaded file checksum does not match declared checksum", request.id));
    }

    const uploadResult = await handleUploadCompleted(deps, {
      videoId: video.videoId,
      tenantId: video.tenantId,
      objectPath: video.objectPath,
      correlationId: video.correlationId
    });

    const updatedVideo = await deps.videoRepository.findById(video.videoId);
    if (!updatedVideo) {
      throw new Error("VIDEO_NOT_FOUND");
    }

    const response: UploadVideoResponse = {
      videoId: updatedVideo.videoId,
      status: updatedVideo.status,
      activeStage: updatedVideo.activeStage,
      progressPercent: updatedVideo.progressPercent,
      uploadedBytes,
      uploadedChecksumSha256,
      correlationId: uploadResult.correlationId,
      queuedAt: nowIso()
    };

    return reply.status(202).send(response);
  });

  app.get<{ Params: { videoId: string } }>("/videos/:videoId/status", async (request, reply) => {
    const principal = await requirePrincipal(deps, request.headers as Record<string, unknown>);
    if (!principal) {
      return reply.status(401).send(createApiErrorPayload("AUTH_REQUIRED", "Authentication required", request.id));
    }

    const video = await deps.videoRepository.findById(request.params.videoId);
    if (!video || video.ownerUserId !== principal.userId) {
      return reply.status(404).send(createApiErrorPayload("VIDEO_NOT_FOUND", "The requested video does not exist or is not accessible.", request.id));
    }

    const response: VideoStatusResponse = {
      videoId: video.videoId,
      status: video.status,
      activeStage: video.activeStage,
      progressPercent: video.progressPercent,
      updatedAt: video.updatedAt,
      correlationId: video.correlationId
    };

    return reply.status(200).send(response);
  });

  app.get<{ Params: { videoId: string } }>("/videos/:videoId", async (request, reply) => {
    const principal = await requirePrincipal(deps, request.headers as Record<string, unknown>);
    if (!principal) {
      return reply.status(401).send(createApiErrorPayload("AUTH_REQUIRED", "Authentication required", request.id));
    }

    const video = await deps.videoRepository.findById(request.params.videoId);
    if (!video || video.ownerUserId !== principal.userId) {
      return reply.status(404).send(createApiErrorPayload("VIDEO_NOT_FOUND", "The requested video does not exist or is not accessible.", request.id));
    }

    const response: VideoDetailsResponse = await toVideoDetailsResponse(video, deps.assetUrlSigner);
    return reply.status(200).send(response);
  });

  app.get<{ Querystring: { pageToken?: string; limit?: string } }>("/videos", async (request, reply) => {
    const principal = await requirePrincipal(deps, request.headers as Record<string, unknown>);
    if (!principal) {
      return reply.status(401).send(createApiErrorPayload("AUTH_REQUIRED", "Authentication required", request.id));
    }

    let offset = 0;
    try {
      offset = decodePageToken(request.query.pageToken);
    } catch {
      return reply.status(400).send(createApiErrorPayload("INVALID_PAGE_TOKEN", "Invalid page token", request.id));
    }

    const requestedLimit = request.query.limit ? Number.parseInt(request.query.limit, 10) : 20;
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 20;

    const videos = (await deps.videoRepository.listByOwner(principal.userId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    const items = videos.slice(offset, offset + limit).map((video) => ({
      videoId: video.videoId,
      status: video.status,
      activeStage: video.activeStage,
      progressPercent: video.progressPercent,
      createdAt: video.createdAt,
      updatedAt: video.updatedAt,
      correlationId: video.correlationId
    }));

    const nextOffset = offset + items.length;
    const response: ListVideosResponse = {
      items,
      ...(nextOffset < videos.length ? { nextPageToken: encodePageToken(nextOffset) } : {})
    };

    return reply.status(200).send(response);
  });

  app.post<{ Params: { videoId: string }; Body: unknown }>("/videos/:videoId/retry", async (request, reply) => {
    const principal = await requirePrincipal(deps, request.headers as Record<string, unknown>);
    if (!principal) {
      return reply.status(401).send(createApiErrorPayload("AUTH_REQUIRED", "Authentication required", request.id));
    }

    const parsed = RetryVideoRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send(createApiErrorPayload("VALIDATION_ERROR", "Invalid request body", request.id));
    }

    const idempotencyKey = idempotencyKeyFromHeaders(request.headers as Record<string, unknown>);
    const retryScope = `retry-video:${principal.userId}:${request.params.videoId}`;
    if (idempotencyKey && await maybeReplayIdempotentResponse(deps, retryScope, idempotencyKey, reply)) {
      return;
    }

    try {
      const updated = await deps.videoRepository.transitionStatus({
        videoId: request.params.videoId,
        ownerUserId: principal.userId,
        requireCurrentStatus: "failed",
        toStatus: "processing",
        activeStage: parsed.data.stage,
        progressPercent: 10,
        correlationId: randomUUID()
      });

      if (!updated) {
        return reply.status(404).send(createApiErrorPayload("VIDEO_NOT_FOUND", "The requested video does not exist or is not accessible.", request.id));
      }

      const retryEvent: DomainEvent = {
        eventId: randomUUID(),
        eventType: "RetryRequested",
        videoId: updated.videoId,
        tenantId: updated.tenantId,
        stage: parsed.data.stage,
        correlationId: updated.correlationId,
        occurredAt: nowIso(),
        payload: {
          reason: "manual_retry"
        }
      };

      await deps.eventRepository.append(retryEvent);

      await deps.queueProducer.enqueue({
        queue: queueFromStage(parsed.data.stage),
        videoId: updated.videoId,
        tenantId: updated.tenantId,
        stage: parsed.data.stage,
        correlationId: updated.correlationId,
        causationEventId: retryEvent.eventId,
        payload: {
          reason: "manual_retry"
        }
      });

      const response: RetryVideoResponse = {
        videoId: updated.videoId,
        status: updated.status,
        activeStage: updated.activeStage,
        progressPercent: updated.progressPercent,
        updatedAt: updated.updatedAt,
        correlationId: updated.correlationId
      };

      if (idempotencyKey) {
        await storeIdempotentResponse(deps, retryScope, idempotencyKey, 200, response);
      }

      return reply.status(200).send(response);
    } catch (error) {
      if (error instanceof Error && error.message === "STATUS_MISMATCH") {
        return reply.status(409).send(createApiErrorPayload("INVALID_STATE_TRANSITION", "Video must be in failed status to retry", request.id));
      }

      throw error;
    }
  });

  app.delete<{ Params: { videoId: string } }>("/videos/:videoId", async (request, reply) => {
    const principal = await requirePrincipal(deps, request.headers as Record<string, unknown>);
    if (!principal) {
      return reply.status(401).send(createApiErrorPayload("AUTH_REQUIRED", "Authentication required", request.id));
    }

    const video = await deps.videoRepository.findById(request.params.videoId);
    if (!video || video.ownerUserId !== principal.userId) {
      return reply.status(404).send(createApiErrorPayload("VIDEO_NOT_FOUND", "The requested video does not exist or is not accessible.", request.id));
    }

    const idempotencyKey = idempotencyKeyFromHeaders(request.headers as Record<string, unknown>);
    const deleteScope = `delete-video:${principal.userId}:${request.params.videoId}`;
    if (idempotencyKey && await maybeReplayIdempotentResponse(deps, deleteScope, idempotencyKey, reply)) {
      return;
    }

    const deletedAt = nowIso();
    const { activeStage: _activeStage, ...rest } = video;
    await deps.videoRepository.update({
      ...rest,
      status: "deleted",
      progressPercent: 100,
      updatedAt: deletedAt
    });

    const response: DeleteVideoResponse = {
      videoId: video.videoId,
      status: "deleted",
      deletedAt,
      correlationId: video.correlationId
    };

    if (idempotencyKey) {
      await storeIdempotentResponse(deps, deleteScope, idempotencyKey, 200, response);
    }

    return reply.status(200).send(response);
  });
}
