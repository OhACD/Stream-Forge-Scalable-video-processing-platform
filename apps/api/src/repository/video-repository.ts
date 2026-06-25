import { VideoLifecycleStatus, VideoRecord, VideoStage } from "@stream-forge/contracts";

export type VideoStatusTransition = {
  videoId: string;
  ownerUserId?: string;
  toStatus: VideoLifecycleStatus;
  activeStage?: VideoStage;
  progressPercent?: number;
  correlationId?: string;
  requireCurrentStatus?: VideoLifecycleStatus;
};

export interface VideoRepository {
  create(video: VideoRecord): Promise<void>;
  findById(videoId: string): Promise<VideoRecord | null>;
  listByOwner(ownerUserId: string): Promise<VideoRecord[]>;
  listAll(): Promise<VideoRecord[]>;
  update(video: VideoRecord): Promise<void>;
  transitionStatus(transition: VideoStatusTransition): Promise<VideoRecord | null>;
}
