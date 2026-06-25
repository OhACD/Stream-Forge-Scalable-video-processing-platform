import { VideoStage } from "@stream-forge/contracts";

export type QueueName =
  | "ingest-orchestration"
  | "metadata"
  | "thumbnail"
  | "transcode-orchestration"
  | "transcode-chunks-processing"
  | "transcode-chunks-processing-1080p"
  | "transcode-chunks-processing-720p"
  | "transcode-chunks-processing-480p"
  | "transcode-chunks-processing-360p"
  | "transcode-reassembly"
  | "transcript"
  | "notification";

export type QueueEnqueueRequest = {
  queue: QueueName;
  videoId: string;
  tenantId: string;
  stage: VideoStage;
  correlationId: string;
  jobDiscriminator?: string;
  causationEventId?: string;
  payload?: Record<string, unknown>;
};

export type QueueMetricsSnapshot = {
  queue: QueueName;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  total: number;
};

export interface QueueProducer {
  enqueue(request: QueueEnqueueRequest): Promise<string>;
  getMetrics(): Promise<QueueMetricsSnapshot[]>;
}
