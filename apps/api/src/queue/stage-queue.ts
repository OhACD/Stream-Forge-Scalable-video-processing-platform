import { VideoStage } from "@stream-forge/contracts";
import { QueueName } from "./queue-producer.js";

export function queueFromStage(stage: VideoStage): QueueName {
  switch (stage) {
    case "metadata":
      return "metadata";
    case "thumbnail":
      return "thumbnail";
    case "transcode-orchestration":
      return "transcode-orchestration";
    case "transcode-chunks-processing":
      // Note: For profile-specific routing, use dynamic queue names:
      // transcode-chunks-processing-{profile} (1080p, 720p, 480p)
      // This function returns the base queue for reference; actual routing happens in stage-handlers.ts
      return "transcode-chunks-processing";
    case "transcode-reassembly":
      return "transcode-reassembly";
    case "transcript":
      return "transcript";
    case "notification":
      return "notification";
    case "upload":
      return "ingest-orchestration";
  }
}
