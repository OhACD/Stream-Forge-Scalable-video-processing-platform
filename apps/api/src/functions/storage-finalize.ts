import { StorageFinalizeEventSchema, handleStorageFinalizeEvent } from "../bridges/storage-finalize-bridge.js";
import { createRepositoryBundle } from "../runtime.js";

export async function storageFinalizeBridge(event: unknown): Promise<{ accepted: true; jobId: string; videoId: string; tenantId: string }> {
  const parsed = StorageFinalizeEventSchema.parse(event);
  const repositories = createRepositoryBundle({
    info() {},
    error() {},
    warn() {},
    debug() {},
    fatal() {},
    trace() {},
    child() { return this; },
    level: 30,
    silent: false,
    isLevelEnabled() { return true; }
  } as never);

  return handleStorageFinalizeEvent(repositories, parsed);
}