import { VideoRecord } from "@stream-forge/contracts";
import { assertTransitionAllowed } from "@stream-forge/core";
import { VideoRepository } from "./video-repository.js";

export class InMemoryVideoRepository implements VideoRepository {
  private readonly byId = new Map<string, VideoRecord>();

  async create(video: VideoRecord): Promise<void> {
    this.byId.set(video.videoId, video);
  }

  async findById(videoId: string): Promise<VideoRecord | null> {
    return this.byId.get(videoId) ?? null;
  }

  async listByOwner(ownerUserId: string): Promise<VideoRecord[]> {
    return [...this.byId.values()].filter((video) => video.ownerUserId === ownerUserId);
  }

  async listAll(): Promise<VideoRecord[]> {
    return [...this.byId.values()];
  }

  async update(video: VideoRecord): Promise<void> {
    this.byId.set(video.videoId, video);
  }

  async transitionStatus(transition: Parameters<VideoRepository["transitionStatus"]>[0]): Promise<VideoRecord | null> {
    const existing = this.byId.get(transition.videoId);
    if (!existing) {
      return null;
    }

    if (transition.ownerUserId && existing.ownerUserId !== transition.ownerUserId) {
      return null;
    }

    if (transition.requireCurrentStatus && existing.status !== transition.requireCurrentStatus) {
      throw new Error("STATUS_MISMATCH");
    }

    assertTransitionAllowed(existing.status, transition.toStatus);

    const next: VideoRecord = {
      ...existing,
      status: transition.toStatus,
      activeStage: transition.activeStage,
      progressPercent: transition.progressPercent ?? existing.progressPercent,
      correlationId: transition.correlationId ?? existing.correlationId,
      updatedAt: new Date().toISOString()
    };

    this.byId.set(next.videoId, next);
    return next;
  }
}
