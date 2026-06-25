import { Queue } from "bullmq";
import { FastifyBaseLogger } from "fastify";
import { QueueEnqueueRequest, QueueMetricsSnapshot, QueueName, QueueProducer } from "./queue-producer.js";

type QueueMap = Record<QueueName, Queue<QueueEnqueueRequest>>;

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

export class BullMqQueueProducer implements QueueProducer {
  private readonly connection: BullMqConnectionOptions;
  private readonly queues: QueueMap;

  private static toJobIdSegment(raw: string): string {
    // BullMQ reserves ':' for internal key parsing in some code paths.
    return raw.replace(/[^a-zA-Z0-9_-]/g, "-");
  }

  constructor(private readonly logger: FastifyBaseLogger, redisUrl: string) {
    this.connection = connectionFromRedisUrl(redisUrl);

    this.queues = {
      "ingest-orchestration": new Queue("ingest-orchestration", { connection: this.connection }),
      metadata: new Queue("metadata", { connection: this.connection }),
      thumbnail: new Queue("thumbnail", { connection: this.connection }),
      "transcode-orchestration": new Queue("transcode-orchestration", { connection: this.connection }),
      "transcode-chunks-processing": new Queue("transcode-chunks-processing", { connection: this.connection }),
      "transcode-chunks-processing-1080p": new Queue("transcode-chunks-processing-1080p", {
        connection: this.connection
      }),
      "transcode-chunks-processing-720p": new Queue("transcode-chunks-processing-720p", {
        connection: this.connection
      }),
      "transcode-chunks-processing-480p": new Queue("transcode-chunks-processing-480p", {
        connection: this.connection
      }),
      "transcode-chunks-processing-360p": new Queue("transcode-chunks-processing-360p", {
        connection: this.connection
      }),
      "transcode-reassembly": new Queue("transcode-reassembly", { connection: this.connection }),
      transcript: new Queue("transcript", { connection: this.connection }),
      notification: new Queue("notification", { connection: this.connection })
    };
  }

  async enqueue(request: QueueEnqueueRequest): Promise<string> {
    const queue = this.queues[request.queue];
    const segments = [
      BullMqQueueProducer.toJobIdSegment(request.videoId),
      BullMqQueueProducer.toJobIdSegment(request.stage),
      ...(request.jobDiscriminator
        ? [BullMqQueueProducer.toJobIdSegment(request.jobDiscriminator)]
        : []),
      BullMqQueueProducer.toJobIdSegment(request.correlationId)
    ];
    const jobId = segments.join("__");

    const job = await queue.add(request.stage, request, {
      jobId,
      attempts: request.queue === "notification"
        ? 8
        : request.queue === "transcode-chunks-processing"
          ? 3
          : 5,
      removeOnComplete: 100,
      removeOnFail: 200
    });

    this.logger.info(
      { queue: request.queue, jobId: job.id, videoId: request.videoId, stage: request.stage },
      "Enqueued queue job"
    );

    return String(job.id);
  }

  async getMetrics(): Promise<QueueMetricsSnapshot[]> {
    const queueNames = [
      "ingest-orchestration",
      "metadata",
      "thumbnail",
      "transcode-orchestration",
      "transcode-chunks-processing",
      "transcode-chunks-processing-1080p",
      "transcode-chunks-processing-720p",
      "transcode-chunks-processing-480p",
      "transcode-chunks-processing-360p",
      "transcode-reassembly",
      "transcript",
      "notification"
    ] as const;

    return Promise.all(queueNames.map(async (queueName) => {
      const counts = await this.queues[queueName].getJobCounts("waiting", "active", "completed", "failed", "delayed", "paused");
      const waiting = counts.waiting ?? 0;
      const active = counts.active ?? 0;
      const completed = counts.completed ?? 0;
      const failed = counts.failed ?? 0;
      const delayed = counts.delayed ?? 0;
      const paused = counts.paused ?? 0;

      return {
        queue: queueName,
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused,
        total: waiting + active + completed + failed + delayed + paused
      };
    }));
  }

  async close(): Promise<void> {
    await Promise.all(Object.values(this.queues).map((queue) => queue.close()));
  }
}
