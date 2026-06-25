import { VideoStage } from "@stream-forge/contracts";

export function buildIdempotencyKey(videoId: string, stage: VideoStage, attemptGroup: string): string {
  return `${videoId}:${stage}:${attemptGroup}`;
}
