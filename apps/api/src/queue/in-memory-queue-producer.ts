import { QueueEnqueueRequest, QueueMetricsSnapshot, QueueProducer } from "./queue-producer.js";

export type MemoryQueueJob = QueueEnqueueRequest & { jobId: string; enqueuedAt: string };

export class InMemoryQueueProducer implements QueueProducer {
  private readonly jobs: MemoryQueueJob[] = [];

  async enqueue(request: QueueEnqueueRequest): Promise<string> {
    const jobId = request.jobDiscriminator
      ? `${request.videoId}:${request.stage}:${request.jobDiscriminator}:${request.correlationId}`
      : `${request.videoId}:${request.stage}:${request.correlationId}`;
    this.jobs.push({
      ...request,
      jobId,
      enqueuedAt: new Date().toISOString()
    });

    return jobId;
  }

  getJobs(): MemoryQueueJob[] {
    return [...this.jobs];
  }

  dequeueNext(): MemoryQueueJob | null {
    const next = this.jobs.shift();
    return next ?? null;
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

    return queueNames.map((queueName) => {
      const jobs = this.jobs.filter((job) => job.queue === queueName);
      return {
        queue: queueName,
        waiting: jobs.length,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: 0,
        total: jobs.length
      };
    });
  }
}
