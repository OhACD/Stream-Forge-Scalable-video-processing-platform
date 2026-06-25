import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, normalize, resolve, sep } from "node:path";

function objectStoreRoot(): string {
  const configured = process.env.STREAM_FORGE_OBJECT_STORE_ROOT;
  if (configured && configured.trim().length > 0) {
    return resolve(configured);
  }

  return resolve(process.cwd(), ".stream-forge-object-store");
}

function sanitizeObjectPath(objectPath: string): string {
  const normalized = normalize(objectPath).replace(/^\/+/, "");
  if (normalized.startsWith("..") || normalized.includes(`${sep}..${sep}`)) {
    throw new Error("INVALID_OBJECT_PATH");
  }

  return normalized;
}

export function resolveLocalObjectPath(objectPath: string): string {
  const root = objectStoreRoot();
  const safeObjectPath = sanitizeObjectPath(objectPath);
  const absolute = resolve(root, safeObjectPath);
  if (!absolute.startsWith(root)) {
    throw new Error("INVALID_OBJECT_PATH");
  }

  return absolute;
}

export async function ensureLocalObjectParent(objectPath: string): Promise<string> {
  const absolutePath = resolveLocalObjectPath(objectPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  return absolutePath;
}

export async function writeLocalObjectFromChunks(objectPath: string, chunks: AsyncIterable<Buffer>): Promise<void> {
  const absolutePath = await ensureLocalObjectParent(objectPath);
  const stream = createWriteStream(absolutePath);

  try {
    for await (const chunk of chunks) {
      if (!stream.write(chunk)) {
        await new Promise<void>((resolveDrain, rejectDrain) => {
          stream.once("drain", resolveDrain);
          stream.once("error", rejectDrain);
        });
      }
    }

    await new Promise<void>((resolveFinish, rejectFinish) => {
      stream.end(() => resolveFinish());
      stream.once("error", rejectFinish);
    });
  } catch (error) {
    stream.destroy();
    throw error;
  }
}
