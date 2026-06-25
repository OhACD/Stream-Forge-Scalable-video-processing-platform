import { randomUUID } from "node:crypto";
import { z } from "zod";
import { QueueProducer } from "../queue/queue-producer.js";

export const StorageFinalizeEventSchema = z.object({
  bucket: z.string().min(1),
  name: z.string().min(1),
  contentType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  correlationId: z.string().uuid().optional()
});

export type StorageFinalizeEventInput = z.infer<typeof StorageFinalizeEventSchema>;

export type StorageFinalizeBridgeDeps = {
  queueProducer: QueueProducer;
};

export type StorageFinalizeBridgeResult = {
  accepted: true;
  jobId: string;
  videoId: string;
  tenantId: string;
};

function parseSourceObjectPath(objectPath: string): { tenantId: string; videoId: string } | null {
  const match = /^tenants\/([^/]+)\/videos\/([^/]+)\/source\/.+$/.exec(objectPath);
  if (!match) {
    return null;
  }

  return {
    tenantId: match[1]!,
    videoId: match[2]!
  };
}

export async function handleStorageFinalizeEvent(
  deps: StorageFinalizeBridgeDeps,
  input: StorageFinalizeEventInput
): Promise<StorageFinalizeBridgeResult> {
  const objectRef = parseSourceObjectPath(input.name);
  if (!objectRef) {
    throw new Error("INVALID_SOURCE_OBJECT_PATH");
  }

  const jobId = await deps.queueProducer.enqueue({
    queue: "ingest-orchestration",
    videoId: objectRef.videoId,
    tenantId: objectRef.tenantId,
    stage: "upload",
    correlationId: input.correlationId ?? randomUUID(),
    payload: {
      bucket: input.bucket,
      sourceObjectPath: input.name,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes
    }
  });

  return {
    accepted: true,
    jobId,
    videoId: objectRef.videoId,
    tenantId: objectRef.tenantId
  };
}