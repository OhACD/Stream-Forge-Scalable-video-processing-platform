import { FastifyInstance } from "fastify";
import { createApiErrorPayload } from "../http/api-error.js";
import { handleStorageFinalizeEvent, StorageFinalizeEventSchema, StorageFinalizeBridgeDeps } from "../bridges/storage-finalize-bridge.js";

type StorageEventRouteDeps = StorageFinalizeBridgeDeps;

function hasInternalAccess(tokenHeader: unknown): boolean {
  const configuredToken = process.env.STREAM_FORGE_INTERNAL_TOKEN;
  if (!configuredToken) {
    return process.env.NODE_ENV !== "production";
  }

  return typeof tokenHeader === "string" && tokenHeader === configuredToken;
}

export async function registerStorageEventRoutes(app: FastifyInstance, deps: StorageEventRouteDeps): Promise<void> {
  app.post<{ Body: unknown }>("/internal/storage/finalize", async (request, reply) => {
    if (!hasInternalAccess(request.headers["x-internal-token"])) {
      return reply.status(401).send({ message: "Invalid internal token" });
    }

    const parsed = StorageFinalizeEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ message: "Invalid request body", issues: parsed.error.issues });
    }

    try {
      const result = await handleStorageFinalizeEvent(deps, parsed.data);
      return reply.status(202).send(result);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_SOURCE_OBJECT_PATH") {
        return reply.status(400).send(createApiErrorPayload("INVALID_SOURCE_OBJECT_PATH", "Object path does not match expected source upload pattern", request.id));
      }

      throw error;
    }
  });
}
