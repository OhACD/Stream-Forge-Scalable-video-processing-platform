import { Firestore } from "@google-cloud/firestore";
import { VideoRecord, VideoRecordSchema } from "@stream-forge/contracts";
import { assertTransitionAllowed } from "@stream-forge/core";
import { VideoRepository, VideoStatusTransition } from "./video-repository.js";

const videosCollection = "videos";
const statusShardsCollection = "video_status_shards";

export class FirestoreVideoRepository implements VideoRepository {
  constructor(private readonly firestore: Firestore) {}

  async create(video: VideoRecord): Promise<void> {
    const videoRef = this.firestore.collection(videosCollection).doc(video.videoId);
    const shardRef = this.firestore.collection(statusShardsCollection).doc(video.videoId);

    await this.firestore.runTransaction(async (tx) => {
      tx.set(videoRef, video);
      tx.set(shardRef, {
        videoId: video.videoId,
        status: video.status,
        activeStage: video.activeStage,
        progressPercent: video.progressPercent,
        updatedAt: video.updatedAt,
        correlationId: video.correlationId
      });
    });
  }

  async findById(videoId: string): Promise<VideoRecord | null> {
    const snap = await this.firestore.collection(videosCollection).doc(videoId).get();
    if (!snap.exists) {
      return null;
    }

    const parsed = VideoRecordSchema.safeParse(snap.data());
    if (!parsed.success) {
      throw new Error("INVALID_VIDEO_RECORD");
    }

    return parsed.data;
  }

  async listByOwner(ownerUserId: string): Promise<VideoRecord[]> {
    const query = this.firestore.collection(videosCollection).where("ownerUserId", "==", ownerUserId);
    const snap = await query.get();

    const rows: VideoRecord[] = [];
    for (const doc of snap.docs) {
      const parsed = VideoRecordSchema.safeParse(doc.data());
      if (parsed.success) {
        rows.push(parsed.data);
      }
    }

    return rows;
  }

  async listAll(): Promise<VideoRecord[]> {
    const snap = await this.firestore.collection(videosCollection).get();

    const rows: VideoRecord[] = [];
    for (const doc of snap.docs) {
      const parsed = VideoRecordSchema.safeParse(doc.data());
      if (parsed.success) {
        rows.push(parsed.data);
      }
    }

    return rows;
  }

  async update(video: VideoRecord): Promise<void> {
    const videoRef = this.firestore.collection(videosCollection).doc(video.videoId);
    const shardRef = this.firestore.collection(statusShardsCollection).doc(video.videoId);

    await this.firestore.runTransaction(async (tx) => {
      tx.set(videoRef, video);
      tx.set(shardRef, {
        videoId: video.videoId,
        status: video.status,
        activeStage: video.activeStage,
        progressPercent: video.progressPercent,
        updatedAt: video.updatedAt,
        correlationId: video.correlationId
      }, { merge: true });
    });
  }

  async transitionStatus(transition: VideoStatusTransition): Promise<VideoRecord | null> {
    const videoRef = this.firestore.collection(videosCollection).doc(transition.videoId);
    const shardRef = this.firestore.collection(statusShardsCollection).doc(transition.videoId);

    return this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(videoRef);
      if (!snap.exists) {
        return null;
      }

      const parsed = VideoRecordSchema.safeParse(snap.data());
      if (!parsed.success) {
        throw new Error("INVALID_VIDEO_RECORD");
      }

      const existing = parsed.data;

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

      tx.set(videoRef, next);
      tx.set(shardRef, {
        videoId: next.videoId,
        status: next.status,
        activeStage: next.activeStage,
        progressPercent: next.progressPercent,
        updatedAt: next.updatedAt,
        correlationId: next.correlationId
      }, { merge: true });

      return next;
    });
  }
}
