import { randomUUID } from "node:crypto";
import {
  DomainEvent,
  DomainEventSchema,
  ThumbnailAsset,
  TranscriptSegment,
  TranscodeVariant,
  VideoTranscript,
  VideoMetadata,
  VideoStageSchema,
  VideoStage
} from "@stream-forge/contracts";
import { QueueProducer, QueueName } from "../queue/queue-producer.js";
import { queueFromStage } from "../queue/stage-queue.js";
import { EventRepository } from "../repository/event-repository.js";
import { VideoRepository } from "../repository/video-repository.js";
import { buildVideoChunks, chunkingEnabledForDuration, resolveChunkDurationSeconds } from "./video-chunker.js";
import {
  extractVideoMetadata,
  generateRealThumbnails,
  isRealMediaPipelineEnabled,
  reassembleVariantChunks,
  sortChunkOutputsByIndex,
  transcodeChunkForProfile,
  writeTranscriptFile
} from "./media-pipeline.js";
import { writeLocalObjectFromChunks } from "../storage/local-object-storage.js";

export type StageHandlerDeps = {
  videoRepository: VideoRepository;
  eventRepository: EventRepository;
  queueProducer: QueueProducer;
};

export type UploadCompletedInput = {
  videoId: string;
  tenantId: string;
  objectPath: string;
  correlationId?: string;
  eventId?: string;
};

export type MetadataRunInput = {
  videoId: string;
  correlationId?: string;
  metadataOverride?: VideoMetadata;
};

export type ThumbnailRunInput = {
  videoId: string;
  correlationId?: string;
  thumbnailsOverride?: ThumbnailAsset[];
};

export type TranscodeRunInput = {
  videoId: string;
  correlationId?: string;
  variantsOverride?: TranscodeVariant[];
};

export type TranscodeOrchestrationRunInput = {
  videoId: string;
  correlationId?: string;
  variantsOverride?: TranscodeVariant[];
};

export type TranscodeChunkRunInput = {
  videoId: string;
  correlationId?: string;
  profile: TranscodeVariant["profile"];
  chunkIndex: number;
  startMs: number;
  endMs: number;
};

export type TranscodeReassemblyRunInput = {
  videoId: string;
  correlationId?: string;
};

export type TranscriptRunInput = {
  videoId: string;
  correlationId?: string;
  transcriptOverride?: VideoTranscript;
};

export type NotificationRunInput = {
  videoId: string;
  correlationId?: string;
};

export type ProcessingFailureInput = {
  videoId: string;
  stage: VideoStage;
  errorMessage: string;
  correlationId?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function chunkJobKey(profile: TranscodeVariant["profile"], chunkIndex: number): string {
  return `${profile}-${chunkIndex}`;
}

function parseChunkStage(raw: unknown): VideoStage {
  const parsed = VideoStageSchema.safeParse(raw);
  if (!parsed.success) {
    return "transcode-chunks-processing";
  }

  return parsed.data;
}

const chunkStateUpdateLocks = new Map<string, Promise<void>>();

async function withChunkStateUpdateLock<T>(videoId: string, operation: () => Promise<T>): Promise<T> {
  const previous = chunkStateUpdateLocks.get(videoId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  chunkStateUpdateLocks.set(videoId, previous.then(() => current));
  await previous;

  try {
    return await operation();
  } finally {
    release();
    if (chunkStateUpdateLocks.get(videoId) === current) {
      chunkStateUpdateLocks.delete(videoId);
    }
  }
}

const PLACEHOLDER_THUMBNAIL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFhUVFRUVFRUVFRUVFRUVFRUXFhUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGxAQGy0lICUvLy0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAXAAEBAQEAAAAAAAAAAAAAAAAAAQID/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAAB9A==",
  "base64"
);

async function ensurePlaceholderThumbnails(thumbnails: ThumbnailAsset[]): Promise<void> {
  await Promise.all(
    thumbnails.map(async (thumbnail) => {
      await writeLocalObjectFromChunks(thumbnail.objectPath, (async function* (): AsyncGenerator<Buffer> {
        yield PLACEHOLDER_THUMBNAIL_JPEG;
      })());
    })
  );
}

export function defaultMetadata(): VideoMetadata {
  return {
    codec: "h264",
    durationMs: 124_500,
    width: 1920,
    height: 1080,
    frameRate: 30,
    bitrateKbps: 4200
  };
}

export function defaultThumbnails(videoId: string, tenantId: string): ThumbnailAsset[] {
  return [
    {
      type: "poster",
      objectPath: `tenants/${tenantId}/videos/${videoId}/thumbnails/poster.jpg`,
      width: 1280,
      height: 720,
      timestampMs: 1000
    },
    {
      type: "timeline",
      objectPath: `tenants/${tenantId}/videos/${videoId}/thumbnails/timeline-0001.jpg`,
      width: 640,
      height: 360,
      timestampMs: 10000
    }
  ];
}

export function defaultVariants(videoId: string, tenantId: string): TranscodeVariant[] {
  return [
    {
      profile: "1080p",
      objectPath: `tenants/${tenantId}/videos/${videoId}/variants/1080p/output.mp4`,
      codec: "h264",
      bitrateKbps: 5000,
      width: 1920,
      height: 1080
    },
    {
      profile: "720p",
      objectPath: `tenants/${tenantId}/videos/${videoId}/variants/720p/output.mp4`,
      codec: "h264",
      bitrateKbps: 3000,
      width: 1280,
      height: 720
    },
    {
      profile: "480p",
      objectPath: `tenants/${tenantId}/videos/${videoId}/variants/480p/output.mp4`,
      codec: "h264",
      bitrateKbps: 1500,
      width: 854,
      height: 480
    }
  ];
}

export function defaultTranscript(videoId: string, tenantId: string): VideoTranscript {
  const segments: TranscriptSegment[] = [
    { startMs: 0, endMs: 4000, text: "Welcome to Stream Forge." },
    { startMs: 4000, endMs: 9000, text: "Your video is now processed in chunked stages." }
  ];

  return {
    language: "en-US",
    objectPath: `tenants/${tenantId}/videos/${videoId}/transcripts/default.vtt`,
    segments
  };
}

export async function handleUploadCompleted(deps: StageHandlerDeps, input: UploadCompletedInput) {
  const correlationId = input.correlationId ?? randomUUID();

  const updated = await deps.videoRepository.transitionStatus({
    videoId: input.videoId,
    toStatus: "processing",
    activeStage: "metadata",
    progressPercent: 20,
    correlationId
  });

  if (!updated) {
    throw new Error("VIDEO_NOT_FOUND");
  }

  const uploadCompletedEvent: DomainEvent = {
    eventId: input.eventId ?? randomUUID(),
    eventType: "UploadCompleted",
    videoId: updated.videoId,
    tenantId: updated.tenantId,
    stage: "upload",
    correlationId,
    occurredAt: nowIso(),
    payload: {
      objectPath: input.objectPath
    }
  };

  DomainEventSchema.parse(uploadCompletedEvent);
  await deps.eventRepository.append(uploadCompletedEvent);

  const metadataJobId = await deps.queueProducer.enqueue({
    queue: "metadata",
    videoId: updated.videoId,
    tenantId: updated.tenantId,
    stage: "metadata",
    correlationId,
    causationEventId: uploadCompletedEvent.eventId,
    payload: {
      sourceObjectPath: input.objectPath
    }
  });

  return {
    accepted: true,
    videoId: updated.videoId,
    status: updated.status,
    activeStage: updated.activeStage,
    correlationId,
    metadataJobId
  };
}

export async function handleMetadataRun(deps: StageHandlerDeps, input: MetadataRunInput) {
  const video = await deps.videoRepository.findById(input.videoId);
  if (!video) {
    throw new Error("VIDEO_NOT_FOUND");
  }
  if (video.status !== "processing" || video.activeStage !== "metadata") {
    throw new Error("INVALID_STAGE_STATE");
  }

  const correlationId = input.correlationId ?? video.correlationId;
  const metadataStartedEvent: DomainEvent = {
    eventId: randomUUID(),
    eventType: "StageStarted",
    videoId: video.videoId,
    tenantId: video.tenantId,
    stage: "metadata",
    correlationId,
    occurredAt: nowIso(),
    payload: {}
  };

  DomainEventSchema.parse(metadataStartedEvent);
  await deps.eventRepository.append(metadataStartedEvent);

  const metadata = input.metadataOverride
    ?? (isRealMediaPipelineEnabled() ? await extractVideoMetadata(video.objectPath) : defaultMetadata());

  await deps.videoRepository.update({
    ...video,
    status: "processing",
    activeStage: "thumbnail",
    progressPercent: 40,
    correlationId,
    metadata,
    updatedAt: nowIso()
  });

  const metadataExtractedEvent: DomainEvent = {
    eventId: randomUUID(),
    eventType: "MetadataExtracted",
    videoId: video.videoId,
    tenantId: video.tenantId,
    stage: "metadata",
    correlationId,
    occurredAt: nowIso(),
    payload: {
      metadata
    }
  };

  DomainEventSchema.parse(metadataExtractedEvent);
  await deps.eventRepository.append(metadataExtractedEvent);

  const thumbnailJobId = await deps.queueProducer.enqueue({
    queue: queueFromStage("thumbnail"),
    videoId: video.videoId,
    tenantId: video.tenantId,
    stage: "thumbnail",
    correlationId,
    causationEventId: metadataExtractedEvent.eventId,
    payload: {
      metadata
    }
  });

  const finalVideo = await deps.videoRepository.findById(video.videoId);
  return {
    handled: true,
    videoId: video.videoId,
    correlationId,
    thumbnailJobId,
    status: finalVideo?.status,
    activeStage: finalVideo?.activeStage,
    progressPercent: finalVideo?.progressPercent,
    metadata: finalVideo?.metadata
  };
}

export async function handleThumbnailRun(deps: StageHandlerDeps, input: ThumbnailRunInput) {
  const video = await deps.videoRepository.findById(input.videoId);
  if (!video) {
    throw new Error("VIDEO_NOT_FOUND");
  }
  if (video.status !== "processing" || video.activeStage !== "thumbnail") {
    throw new Error("INVALID_STAGE_STATE");
  }

  const correlationId = input.correlationId ?? video.correlationId;
  const thumbnails = input.thumbnailsOverride
    ?? (isRealMediaPipelineEnabled()
      ? await generateRealThumbnails(
        video.videoId,
        video.tenantId,
        video.objectPath,
        video.metadata?.durationMs ?? defaultMetadata().durationMs
      )
      : defaultThumbnails(video.videoId, video.tenantId));

  if (!isRealMediaPipelineEnabled()) {
    await ensurePlaceholderThumbnails(thumbnails);
  }

  await deps.videoRepository.update({
    ...video,
    status: "processing",
    activeStage: "transcode-orchestration",
    progressPercent: 65,
    correlationId,
    thumbnails,
    updatedAt: nowIso()
  });

  const thumbnailGeneratedEvent: DomainEvent = {
    eventId: randomUUID(),
    eventType: "ThumbnailGenerated",
    videoId: video.videoId,
    tenantId: video.tenantId,
    stage: "thumbnail",
    correlationId,
    occurredAt: nowIso(),
    payload: {
      thumbnails
    }
  };

  DomainEventSchema.parse(thumbnailGeneratedEvent);
  await deps.eventRepository.append(thumbnailGeneratedEvent);

  const transcodeJobId = await deps.queueProducer.enqueue({
    queue: queueFromStage("transcode-orchestration"),
    videoId: video.videoId,
    tenantId: video.tenantId,
    stage: "transcode-orchestration",
    correlationId,
    causationEventId: thumbnailGeneratedEvent.eventId,
    payload: {
      metadata: video.metadata,
      thumbnails
    }
  });

  const finalVideo = await deps.videoRepository.findById(video.videoId);
  return {
    handled: true,
    videoId: video.videoId,
    correlationId,
    transcodeJobId,
    status: finalVideo?.status,
    activeStage: finalVideo?.activeStage,
    progressPercent: finalVideo?.progressPercent,
    thumbnails: finalVideo?.thumbnails
  };
}

export async function handleTranscodeOrchestrationRun(deps: StageHandlerDeps, input: TranscodeOrchestrationRunInput) {
  const video = await deps.videoRepository.findById(input.videoId);
  if (!video) {
    throw new Error("VIDEO_NOT_FOUND");
  }
  if (video.status !== "processing" || video.activeStage !== "transcode-orchestration") {
    throw new Error("INVALID_STAGE_STATE");
  }

  const correlationId = input.correlationId ?? video.correlationId;
  const variants = input.variantsOverride ?? defaultVariants(video.videoId, video.tenantId);
  const profiles = [...new Set(variants.map((variant) => variant.profile))] as TranscodeVariant["profile"][];
  const chunkDurationSeconds = resolveChunkDurationSeconds();
  const durationMs = Math.max(video.metadata?.durationMs ?? 0, 1000);
  const chunkingEnabled = chunkingEnabledForDuration(durationMs);
  const chunks = buildVideoChunks(durationMs, chunkDurationSeconds);
  const expectedJobKeys = chunks.flatMap((chunk) => profiles.map((profile) => chunkJobKey(profile, chunk.index)));

  await deps.videoRepository.update({
    ...video,
    status: "processing",
    activeStage: "transcode-chunks-processing",
    progressPercent: 70,
    correlationId,
    transcodeChunkState: {
      chunkDurationSeconds,
      totalChunks: chunks.length,
      profiles,
      expectedJobKeys,
      completedJobKeys: [],
      outputs: []
    },
    updatedAt: nowIso()
  });

  const transcodeChunksEnqueuedEvent: DomainEvent = {
    eventId: randomUUID(),
    eventType: "TranscodeChunksEnqueued",
    videoId: video.videoId,
    tenantId: video.tenantId,
    stage: "transcode-orchestration",
    correlationId,
    occurredAt: nowIso(),
    payload: {
      chunkingEnabled,
      chunkDurationSeconds,
      totalChunks: chunks.length,
      profiles,
      chunking: {
        enabled: chunkingEnabled,
        chunkDurationSeconds,
        chunkCount: chunks.length,
        chunks
      }
    }
  };

  DomainEventSchema.parse(transcodeChunksEnqueuedEvent);
  await deps.eventRepository.append(transcodeChunksEnqueuedEvent);

  const chunkJobIds = await Promise.all(
    chunks.flatMap((chunk) =>
      profiles.map((profile) => {
        const queueName: QueueName = `transcode-chunks-processing-${profile}` as const;
        return deps.queueProducer.enqueue({
          queue: queueName,
          videoId: video.videoId,
          tenantId: video.tenantId,
          stage: "transcode-chunks-processing",
          correlationId,
          jobDiscriminator: chunkJobKey(profile, chunk.index),
          causationEventId: transcodeChunksEnqueuedEvent.eventId,
          payload: {
            profile,
            chunkIndex: chunk.index,
            startMs: chunk.startMs,
            endMs: chunk.endMs
          }
        });
      })
    )
  );

  const finalVideo = await deps.videoRepository.findById(video.videoId);
  return {
    handled: true,
    videoId: video.videoId,
    correlationId,
    chunkJobIds,
    profiles,
    status: finalVideo?.status,
    activeStage: finalVideo?.activeStage,
    progressPercent: finalVideo?.progressPercent,
    variants,
    chunking: {
      enabled: chunkingEnabled,
      chunkDurationSeconds,
      chunkCount: chunks.length,
      chunks
    }
  };
}

export async function handleTranscodeChunkRun(deps: StageHandlerDeps, input: TranscodeChunkRunInput) {
  const video = await deps.videoRepository.findById(input.videoId);
  if (!video) {
    throw new Error("VIDEO_NOT_FOUND");
  }

  if (video.status !== "processing") {
    throw new Error("INVALID_STAGE_STATE");
  }

  if (video.activeStage !== "transcode-chunks-processing" && video.activeStage !== "transcode-reassembly") {
    throw new Error("INVALID_STAGE_STATE");
  }

  if (!video.transcodeChunkState) {
    throw new Error("INVALID_CHUNK_STATE");
  }

  const correlationId = input.correlationId ?? video.correlationId;
  const key = chunkJobKey(input.profile, input.chunkIndex);

  const outputPath = `tenants/${video.tenantId}/videos/${video.videoId}/variants/${input.profile}/chunks/chunk-${String(input.chunkIndex).padStart(4, "0")}.mp4`;
  if (isRealMediaPipelineEnabled()) {
    const variantSpec = defaultVariants(video.videoId, video.tenantId).find((variant) => variant.profile === input.profile);
    if (!variantSpec) {
      throw new Error("INVALID_PROFILE");
    }

    await transcodeChunkForProfile(video.objectPath, outputPath, variantSpec, input.startMs, input.endMs);
  }

  return withChunkStateUpdateLock(video.videoId, async () => {
    const latest = await deps.videoRepository.findById(video.videoId);
    if (!latest) {
      throw new Error("VIDEO_NOT_FOUND");
    }

    if (latest.status !== "processing") {
      throw new Error("INVALID_STAGE_STATE");
    }

    if (latest.activeStage !== "transcode-chunks-processing" && latest.activeStage !== "transcode-reassembly") {
      throw new Error("INVALID_STAGE_STATE");
    }

    const state = latest.transcodeChunkState;
    if (!state) {
      throw new Error("INVALID_CHUNK_STATE");
    }

    if (state.completedJobKeys.includes(key)) {
      return {
        handled: true,
        duplicate: true,
        videoId: latest.videoId,
        correlationId,
        completedJobs: state.completedJobKeys.length,
        expectedJobs: state.expectedJobKeys.length
      };
    }

    const nextCompleted = [...state.completedJobKeys, key];
    const nextOutputs = [
      ...state.outputs,
      {
        profile: input.profile,
        chunkIndex: input.chunkIndex,
        objectPath: outputPath
      }
    ];

    const completedAllJobs = nextCompleted.length >= state.expectedJobKeys.length;
    const progress = 70 + Math.floor((nextCompleted.length / Math.max(1, state.expectedJobKeys.length)) * 19);

    await deps.videoRepository.update({
      ...latest,
      status: "processing",
      activeStage: completedAllJobs ? "transcode-reassembly" : "transcode-chunks-processing",
      progressPercent: completedAllJobs ? 90 : Math.min(progress, 89),
      correlationId,
      transcodeChunkState: {
        ...state,
        completedJobKeys: nextCompleted,
        outputs: nextOutputs
      },
      updatedAt: nowIso()
    });

    if (!completedAllJobs) {
      return {
        handled: true,
        duplicate: false,
        videoId: latest.videoId,
        correlationId,
        completedJobs: nextCompleted.length,
        expectedJobs: state.expectedJobKeys.length
      };
    }

    const reassemblyJobId = await deps.queueProducer.enqueue({
      queue: queueFromStage("transcode-reassembly"),
      videoId: latest.videoId,
      tenantId: latest.tenantId,
      stage: "transcode-reassembly",
      correlationId,
      jobDiscriminator: "final",
      payload: {
        completedJobs: nextCompleted.length,
        expectedJobs: state.expectedJobKeys.length
      }
    });

    return {
      handled: true,
      duplicate: false,
      videoId: latest.videoId,
      correlationId,
      completedJobs: nextCompleted.length,
      expectedJobs: state.expectedJobKeys.length,
      reassemblyJobId
    };
  });
}

export async function handleTranscodeReassemblyRun(deps: StageHandlerDeps, input: TranscodeReassemblyRunInput) {
  const video = await deps.videoRepository.findById(input.videoId);
  if (!video) {
    throw new Error("VIDEO_NOT_FOUND");
  }
  if (video.status !== "processing" || video.activeStage !== "transcode-reassembly") {
    throw new Error("INVALID_STAGE_STATE");
  }

  const state = video.transcodeChunkState;
  if (!state || state.completedJobKeys.length < state.expectedJobKeys.length) {
    throw new Error("INVALID_CHUNK_STATE");
  }

  const correlationId = input.correlationId ?? video.correlationId;
  const sourceVariants = defaultVariants(video.videoId, video.tenantId);
  const variants = sourceVariants.filter((variant) => state.profiles.includes(variant.profile));

  if (isRealMediaPipelineEnabled()) {
    for (const variant of variants) {
      const profileChunks = state.outputs.filter((output) => output.profile === variant.profile);
      const orderedChunkPaths = sortChunkOutputsByIndex(profileChunks);
      if (orderedChunkPaths.length === 0) {
        throw new Error("MISSING_PROFILE_CHUNKS");
      }

      await reassembleVariantChunks(variant.objectPath, orderedChunkPaths);
    }
  }

  await deps.videoRepository.update({
    ...video,
    status: "processing",
    activeStage: "transcript",
    progressPercent: 94,
    correlationId,
    variants,
    updatedAt: nowIso()
  });

  const transcodingCompletedEvent: DomainEvent = {
    eventId: randomUUID(),
    eventType: "TranscodingCompleted",
    videoId: video.videoId,
    tenantId: video.tenantId,
    stage: "transcode-reassembly",
    correlationId,
    occurredAt: nowIso(),
    payload: {
      variants,
      chunking: {
        totalChunks: state.totalChunks,
        completedJobs: state.completedJobKeys.length,
        expectedJobs: state.expectedJobKeys.length
      }
    }
  };

  DomainEventSchema.parse(transcodingCompletedEvent);
  await deps.eventRepository.append(transcodingCompletedEvent);

  const transcriptJobId = await deps.queueProducer.enqueue({
    queue: queueFromStage("transcript"),
    videoId: video.videoId,
    tenantId: video.tenantId,
    stage: "transcript",
    correlationId,
    causationEventId: transcodingCompletedEvent.eventId,
    payload: {
      variantsCount: variants.length
    }
  });

  const finalVideo = await deps.videoRepository.findById(video.videoId);
  return {
    handled: true,
    videoId: video.videoId,
    correlationId,
    transcriptJobId,
    status: finalVideo?.status,
    activeStage: finalVideo?.activeStage,
    progressPercent: finalVideo?.progressPercent,
    variants: finalVideo?.variants
  };
}

export async function handleTranscriptRun(deps: StageHandlerDeps, input: TranscriptRunInput) {
  const video = await deps.videoRepository.findById(input.videoId);
  if (!video) {
    throw new Error("VIDEO_NOT_FOUND");
  }
  if (video.status !== "processing" || video.activeStage !== "transcript") {
    throw new Error("INVALID_STAGE_STATE");
  }

  const correlationId = input.correlationId ?? video.correlationId;
  const transcript = input.transcriptOverride
    ?? defaultTranscript(video.videoId, video.tenantId);

  if (isRealMediaPipelineEnabled() && transcript.objectPath) {
    await writeTranscriptFile(
      transcript.objectPath,
      transcript.language ?? "en-US",
      video.metadata?.durationMs ?? 30_000
    );
  }

  await deps.videoRepository.update({
    ...video,
    status: "processing",
    activeStage: "notification",
    progressPercent: 97,
    correlationId,
    transcript,
    updatedAt: nowIso()
  });

  const transcriptGeneratedEvent: DomainEvent = {
    eventId: randomUUID(),
    eventType: "TranscriptGenerated",
    videoId: video.videoId,
    tenantId: video.tenantId,
    stage: "transcript",
    correlationId,
    occurredAt: nowIso(),
    payload: {
      transcript
    }
  };

  DomainEventSchema.parse(transcriptGeneratedEvent);
  await deps.eventRepository.append(transcriptGeneratedEvent);

  const notificationJobId = await deps.queueProducer.enqueue({
    queue: queueFromStage("notification"),
    videoId: video.videoId,
    tenantId: video.tenantId,
    stage: "notification",
    correlationId,
    causationEventId: transcriptGeneratedEvent.eventId,
    payload: {
      transcript
    }
  });

  const finalVideo = await deps.videoRepository.findById(video.videoId);
  return {
    handled: true,
    videoId: video.videoId,
    correlationId,
    notificationJobId,
    status: finalVideo?.status,
    activeStage: finalVideo?.activeStage,
    progressPercent: finalVideo?.progressPercent,
    transcript: finalVideo?.transcript
  };
}

export async function handleTranscodeRun(deps: StageHandlerDeps, input: TranscodeRunInput) {
  const orchestration = await handleTranscodeOrchestrationRun(deps, {
    videoId: input.videoId,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.variantsOverride ? { variantsOverride: input.variantsOverride } : {})
  });

  const profiles = orchestration.profiles;
  const chunks = orchestration.chunking.chunks;
  for (const chunk of chunks) {
    for (const profile of profiles) {
      await handleTranscodeChunkRun(deps, {
        videoId: input.videoId,
        correlationId: orchestration.correlationId,
        profile,
        chunkIndex: chunk.index,
        startMs: chunk.startMs,
        endMs: chunk.endMs
      });
    }
  }

  const afterChunking = await deps.videoRepository.findById(input.videoId);
  if (afterChunking?.status === "processing" && afterChunking.activeStage === "transcode-reassembly") {
    await handleTranscodeReassemblyRun(deps, {
      videoId: input.videoId,
      correlationId: orchestration.correlationId
    });
  }

  const afterReassembly = await deps.videoRepository.findById(input.videoId);
  if (afterReassembly?.status === "processing" && afterReassembly.activeStage === "transcript") {
    await handleTranscriptRun(deps, {
      videoId: input.videoId,
      correlationId: orchestration.correlationId
    });
  }

  const finalVideo = await deps.videoRepository.findById(input.videoId);
  return {
    handled: true,
    videoId: input.videoId,
    correlationId: orchestration.correlationId,
    status: finalVideo?.status,
    activeStage: finalVideo?.activeStage,
    progressPercent: finalVideo?.progressPercent,
    variants: finalVideo?.variants,
    transcript: finalVideo?.transcript
  };
}

export async function handleNotificationRun(deps: StageHandlerDeps, input: NotificationRunInput) {
  const video = await deps.videoRepository.findById(input.videoId);
  if (!video) {
    throw new Error("VIDEO_NOT_FOUND");
  }
  if (video.status !== "processing" || video.activeStage !== "notification") {
    throw new Error("INVALID_STAGE_STATE");
  }

  const correlationId = input.correlationId ?? video.correlationId;
  const updated = await deps.videoRepository.transitionStatus({
    videoId: video.videoId,
    toStatus: "ready",
    activeStage: "notification",
    progressPercent: 100,
    correlationId,
    requireCurrentStatus: "processing"
  });

  if (!updated) {
    throw new Error("VIDEO_NOT_FOUND");
  }

  const readyEvent: DomainEvent = {
    eventId: randomUUID(),
    eventType: "VideoReady",
    videoId: updated.videoId,
    tenantId: updated.tenantId,
    stage: "notification",
    correlationId,
    occurredAt: nowIso(),
    payload: {
      variants: updated.variants,
      thumbnails: updated.thumbnails,
      transcript: updated.transcript
    }
  };

  DomainEventSchema.parse(readyEvent);
  await deps.eventRepository.append(readyEvent);

  return {
    handled: true,
    videoId: updated.videoId,
    correlationId,
    status: updated.status,
    activeStage: updated.activeStage,
    progressPercent: updated.progressPercent
  };
}

export async function handleProcessingFailure(deps: StageHandlerDeps, input: ProcessingFailureInput) {
  const video = await deps.videoRepository.findById(input.videoId);
  if (!video) {
    throw new Error("VIDEO_NOT_FOUND");
  }

  if (video.status === "failed") {
    return {
      handled: true,
      videoId: video.videoId,
      correlationId: input.correlationId ?? video.correlationId,
      status: video.status,
      activeStage: video.activeStage,
      progressPercent: video.progressPercent
    };
  }

  if (video.status !== "processing" && video.status !== "partially_complete") {
    throw new Error("INVALID_STAGE_STATE");
  }

  const correlationId = input.correlationId ?? video.correlationId;
  const normalizedStage = parseChunkStage(input.stage);
  const failed = await deps.videoRepository.transitionStatus({
    videoId: video.videoId,
    toStatus: "failed",
    activeStage: normalizedStage,
    progressPercent: video.progressPercent,
    correlationId
  });

  if (!failed) {
    throw new Error("VIDEO_NOT_FOUND");
  }

  const processingFailedEvent: DomainEvent = {
    eventId: randomUUID(),
    eventType: "ProcessingFailed",
    videoId: failed.videoId,
    tenantId: failed.tenantId,
    stage: normalizedStage,
    correlationId,
    occurredAt: nowIso(),
    payload: {
      errorMessage: input.errorMessage,
      stage: normalizedStage
    }
  };

  DomainEventSchema.parse(processingFailedEvent);
  await deps.eventRepository.append(processingFailedEvent);

  return {
    handled: true,
    videoId: failed.videoId,
    correlationId,
    status: failed.status,
    activeStage: failed.activeStage,
    progressPercent: failed.progressPercent
  };
}
