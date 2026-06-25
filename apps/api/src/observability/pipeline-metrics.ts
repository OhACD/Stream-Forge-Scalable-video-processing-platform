import { DomainEvent, VideoStage } from "@stream-forge/contracts";

const latencyBucketsMs = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000] as const;

type HistogramSeries = {
  count: number;
  sumMs: number;
  buckets: number[];
};

export type PipelineMetricsSummary = {
  successTotal: number;
  failureTotal: number;
  successRate: number;
  terminalTotal: number;
  uploadToFirstStageStart: HistogramSeries;
  endToEnd: HistogramSeries;
  stageFailures: Record<VideoStage, number>;
};

function createHistogramSeries(): HistogramSeries {
  return {
    count: 0,
    sumMs: 0,
    buckets: new Array(latencyBucketsMs.length + 1).fill(0)
  };
}

function observe(series: HistogramSeries, durationMs: number): void {
  series.count += 1;
  series.sumMs += durationMs;

  let bucketIndex = latencyBucketsMs.findIndex((bucket) => durationMs <= bucket);
  if (bucketIndex === -1) {
    bucketIndex = latencyBucketsMs.length;
  }

  for (let index = bucketIndex; index < series.buckets.length; index += 1) {
    series.buckets[index] = (series.buckets[index] ?? 0) + 1;
  }
}

function parseOccurredAt(occurredAt: string): number | null {
  const timestamp = Date.parse(occurredAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function createStageFailureSeed(): Record<VideoStage, number> {
  return {
    upload: 0,
    metadata: 0,
    thumbnail: 0,
    "transcode-orchestration": 0,
    "transcode-chunks-processing": 0,
    "transcode-reassembly": 0,
    transcript: 0,
    notification: 0
  };
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function renderHistogramMetric(lines: string[], name: string, help: string, series: HistogramSeries): void {
  lines.push(`# HELP ${name} ${help}`);
  lines.push(`# TYPE ${name} histogram`);

  for (let index = 0; index < latencyBucketsMs.length; index += 1) {
    lines.push(`${name}_bucket{le="${latencyBucketsMs[index]}"} ${series.buckets[index]}`);
  }

  lines.push(`${name}_bucket{le="+Inf"} ${series.count}`);
  lines.push(`${name}_sum ${series.sumMs.toFixed(3)}`);
  lines.push(`${name}_count ${series.count}`);
}

export function summarizePipelineMetrics(events: DomainEvent[]): PipelineMetricsSummary {
  const successTotal = events.filter((event) => event.eventType === "VideoReady").length;
  const failures = events.filter((event) => event.eventType === "ProcessingFailed");
  const failureTotal = failures.length;
  const terminalTotal = successTotal + failureTotal;
  const successRate = terminalTotal === 0 ? 0 : successTotal / terminalTotal;
  const stageFailures = createStageFailureSeed();
  const uploadToFirstStageStart = createHistogramSeries();
  const endToEnd = createHistogramSeries();

  for (const failure of failures) {
    stageFailures[failure.stage] += 1;
  }

  const eventsByVideo = new Map<string, DomainEvent[]>();
  for (const event of events) {
    const videoEvents = eventsByVideo.get(event.videoId) ?? [];
    videoEvents.push(event);
    eventsByVideo.set(event.videoId, videoEvents);
  }

  for (const videoEvents of eventsByVideo.values()) {
    const uploadCompleted = videoEvents.find((event) => event.eventType === "UploadCompleted");
    const firstStageStarted = videoEvents.find(
      (event) => event.eventType === "StageStarted" && event.stage === "metadata"
    );
    const uploadRequested = videoEvents.find((event) => event.eventType === "VideoUploadRequested");
    const ready = videoEvents.find((event) => event.eventType === "VideoReady");

    const uploadCompletedAt = uploadCompleted ? parseOccurredAt(uploadCompleted.occurredAt) : null;
    const firstStageStartedAt = firstStageStarted ? parseOccurredAt(firstStageStarted.occurredAt) : null;
    if (uploadCompletedAt !== null && firstStageStartedAt !== null && firstStageStartedAt >= uploadCompletedAt) {
      observe(uploadToFirstStageStart, firstStageStartedAt - uploadCompletedAt);
    }

    const uploadRequestedAt = uploadRequested ? parseOccurredAt(uploadRequested.occurredAt) : null;
    const readyAt = ready ? parseOccurredAt(ready.occurredAt) : null;
    if (uploadRequestedAt !== null && readyAt !== null && readyAt >= uploadRequestedAt) {
      observe(endToEnd, readyAt - uploadRequestedAt);
    }
  }

  return {
    successTotal,
    failureTotal,
    successRate,
    terminalTotal,
    uploadToFirstStageStart,
    endToEnd,
    stageFailures
  };
}

export function renderPipelineMetrics(summary: PipelineMetricsSummary): string {
  const lines: string[] = [];

  lines.push("# HELP streamforge_pipeline_success_total Total successful pipeline completions");
  lines.push("# TYPE streamforge_pipeline_success_total counter");
  lines.push(`streamforge_pipeline_success_total ${summary.successTotal}`);

  lines.push("# HELP streamforge_pipeline_failure_total Total failed pipeline executions");
  lines.push("# TYPE streamforge_pipeline_failure_total counter");
  lines.push(`streamforge_pipeline_failure_total ${summary.failureTotal}`);

  lines.push("# HELP streamforge_pipeline_success_rate Success rate across terminal pipeline outcomes");
  lines.push("# TYPE streamforge_pipeline_success_rate gauge");
  lines.push(`streamforge_pipeline_success_rate ${summary.successRate.toFixed(6)}`);

  lines.push("# HELP streamforge_pipeline_terminal_total Total terminal pipeline outcomes");
  lines.push("# TYPE streamforge_pipeline_terminal_total gauge");
  lines.push(`streamforge_pipeline_terminal_total ${summary.terminalTotal}`);

  lines.push("# HELP streamforge_pipeline_stage_failure_total Total stage failures by stage");
  lines.push("# TYPE streamforge_pipeline_stage_failure_total counter");
  for (const [stage, count] of Object.entries(summary.stageFailures)) {
    lines.push(`streamforge_pipeline_stage_failure_total{stage="${escapeLabel(stage)}"} ${count}`);
  }

  lines.push("# HELP streamforge_pipeline_stage_failure_rate Stage failure rate across terminal pipeline outcomes");
  lines.push("# TYPE streamforge_pipeline_stage_failure_rate gauge");
  for (const [stage, count] of Object.entries(summary.stageFailures)) {
    const rate = summary.terminalTotal === 0 ? 0 : count / summary.terminalTotal;
    lines.push(`streamforge_pipeline_stage_failure_rate{stage="${escapeLabel(stage)}"} ${rate.toFixed(6)}`);
  }

  renderHistogramMetric(
    lines,
    "streamforge_pipeline_upload_to_first_stage_start_ms",
    "Latency from upload completed event to first stage start in milliseconds",
    summary.uploadToFirstStageStart
  );
  renderHistogramMetric(
    lines,
    "streamforge_pipeline_end_to_end_ms",
    "End-to-end latency from upload request to ready state in milliseconds",
    summary.endToEnd
  );

  return `${lines.join("\n")}\n`;
}