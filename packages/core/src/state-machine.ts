import { VideoLifecycleStatus, VideoStage } from "@stream-forge/contracts";

export type TransitionRule = {
  from: VideoLifecycleStatus;
  to: VideoLifecycleStatus;
};

const allowedTransitions: TransitionRule[] = [
  { from: "queued", to: "processing" },
  { from: "processing", to: "partially_complete" },
  { from: "processing", to: "ready" },
  { from: "processing", to: "failed" },
  { from: "partially_complete", to: "processing" },
  { from: "partially_complete", to: "ready" },
  { from: "partially_complete", to: "failed" },
  { from: "ready", to: "deleted" },
  { from: "failed", to: "processing" },
  { from: "failed", to: "deleted" }
];

export function isTransitionAllowed(from: VideoLifecycleStatus, to: VideoLifecycleStatus): boolean {
  return allowedTransitions.some((rule) => rule.from === from && rule.to === to);
}

export function assertTransitionAllowed(from: VideoLifecycleStatus, to: VideoLifecycleStatus): void {
  if (!isTransitionAllowed(from, to)) {
    throw new Error(`Invalid status transition from ${from} to ${to}`);
  }
}

export function getStageProgress(stage: VideoStage): number {
  switch (stage) {
    case "upload":
      return 10;
    case "metadata":
      return 30;
    case "thumbnail":
      return 50;
    case "transcode-orchestration":
      return 65;
    case "transcode-chunks-processing":
      return 80;
    case "transcode-reassembly":
      return 90;
    case "transcript":
      return 95;
    case "notification":
      return 100;
    default: {
      const unreachable: never = stage;
      throw new Error(`Unhandled stage ${unreachable}`);
    }
  }
}
