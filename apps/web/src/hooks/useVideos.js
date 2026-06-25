import { useState, useEffect, useCallback, useRef } from "react";
import { listVideos, deleteVideo } from "../api/client.js";

const IDLE_POLL_MS = 10_000;
const PROCESSING_POLL_MS = 2_000;

export function useVideos({ session, onEvent }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async (silent = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const data = await listVideos(session);
      const nextItems = data?.items ?? [];
      setVideos(nextItems);
      if (!silent) onEvent?.("Library refreshed.", "ok");

      const hasProcessing = nextItems.some((video) => video.status === "processing");
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        void refresh(true);
      }, hasProcessing ? PROCESSING_POLL_MS : IDLE_POLL_MS);
    } catch (err) {
      if (!silent) onEvent?.(`Could not refresh library: ${err.message}`, "bad");
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        void refresh(true);
      }, PROCESSING_POLL_MS);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [session, onEvent]);

  useEffect(() => {
    setLoading(true);
    void refresh(true);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [refresh]);

  const upsertVideoSnapshot = useCallback((snapshot) => {
    if (!snapshot?.videoId) {
      return;
    }

    setVideos((prev) => {
      const index = prev.findIndex((video) => video.videoId === snapshot.videoId);
      if (index < 0) {
        return prev;
      }

      const next = [...prev];
      next[index] = {
        ...next[index],
        status: snapshot.status,
        activeStage: snapshot.activeStage,
        progressPercent: snapshot.progressPercent,
        updatedAt: snapshot.updatedAt,
        correlationId: snapshot.correlationId
      };
      return next;
    });
  }, []);

  async function removeVideo(id, sessionOverride) {
    await deleteVideo(id, sessionOverride ?? session);
    setVideos((prev) => prev.filter((v) => v.videoId !== id));
    onEvent?.(`Video ${id} deleted.`, "ok");
  }

  return {
    videos,
    loading,
    refresh: () => refresh(false),
    removeVideo,
    upsertVideoSnapshot
  };
}
