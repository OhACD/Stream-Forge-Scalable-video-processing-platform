import { Firestore } from "@google-cloud/firestore";
import { FastifyBaseLogger } from "fastify";
import { AssetUrlSigner, GoogleCloudStorageAssetUrlSigner, HmacAssetUrlSigner } from "./assets/asset-url-signer.js";
import { Authenticator, AuthMode, createAuthRuntime } from "./auth/authenticator.js";
import { BullMqQueueProducer } from "./queue/bullmq-queue-producer.js";
import { InMemoryQueueProducer } from "./queue/in-memory-queue-producer.js";
import { QueueProducer } from "./queue/queue-producer.js";
import { InMemoryEventRepository } from "./repository/in-memory-event-repository.js";
import { FirestoreIdempotencyRepository } from "./repository/firestore-idempotency-repository.js";
import { InMemoryVideoRepository } from "./repository/in-memory-video-repository.js";
import { IdempotencyRepository } from "./repository/idempotency-repository.js";
import { InMemoryIdempotencyRepository } from "./repository/in-memory-idempotency-repository.js";
import { FirestoreEventRepository } from "./repository/firestore-event-repository.js";
import { FirestoreVideoRepository } from "./repository/firestore-video-repository.js";
import { EventRepository } from "./repository/event-repository.js";
import { VideoRepository } from "./repository/video-repository.js";

export type RepositoryBundle = {
  videoRepository: VideoRepository;
  eventRepository: EventRepository;
  idempotencyRepository: IdempotencyRepository;
  queueProducer: QueueProducer;
  assetUrlSigner: AssetUrlSigner;
  authenticator: Authenticator;
  authMode: AuthMode;
  mode: "memory" | "firestore";
  queueMode: "memory" | "bullmq";
};

function isFirestoreEnabled(): boolean {
  return process.env.STREAM_FORGE_REPOSITORY === "firestore";
}

export function createRepositoryBundle(logger: FastifyBaseLogger): RepositoryBundle {
  const redisUrl = process.env.STREAM_FORGE_REDIS_URL;
  const storageBucket = process.env.STREAM_FORGE_STORAGE_BUCKET;
  const assetBaseUrl = process.env.STREAM_FORGE_ASSET_BASE_URL ?? "/assets/signed";
  const signingSecret = process.env.STREAM_FORGE_ASSET_SIGNING_SECRET ?? "dev-only-secret";
  const assetUrlSigner = storageBucket
    ? new GoogleCloudStorageAssetUrlSigner(storageBucket)
    : new HmacAssetUrlSigner(assetBaseUrl, signingSecret, 300);
  const authRuntime = createAuthRuntime();
  const queueProducer = redisUrl
    ? new BullMqQueueProducer(logger, redisUrl)
    : new InMemoryQueueProducer();

  if (!isFirestoreEnabled()) {
    return {
      mode: "memory",
      queueMode: redisUrl ? "bullmq" : "memory",
      videoRepository: new InMemoryVideoRepository(),
      eventRepository: new InMemoryEventRepository(),
      idempotencyRepository: new InMemoryIdempotencyRepository(),
      queueProducer,
      assetUrlSigner,
      authenticator: authRuntime.authenticator,
      authMode: authRuntime.mode
    };
  }

  const firestore = new Firestore();
  logger.info({ mode: "firestore" }, "Using Firestore repositories");

  return {
    mode: "firestore",
    queueMode: redisUrl ? "bullmq" : "memory",
    videoRepository: new FirestoreVideoRepository(firestore),
    eventRepository: new FirestoreEventRepository(firestore),
    idempotencyRepository: new FirestoreIdempotencyRepository(firestore),
    queueProducer,
    assetUrlSigner,
    authenticator: authRuntime.authenticator,
    authMode: authRuntime.mode
  };
}
