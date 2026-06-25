import { useState, useEffect, useCallback, useRef } from "react";
import { getVideo, retryVideo } from "../api/client.js";

const PROCESSING_POLL_MS = 1_500;
const IDLE_POLL_MS = 6_000;

export function useVideoDetail({ videoId, session, addToast, onVideoSnapshot }) {
  const [video, setVideo] = useState(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);
  const inFlightRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!videoId) return;
    if (inFlightRef.current) return null;

    inFlightRef.current = true;
    try {
      const data = await getVideo(videoId, session);
      setVideo(data);
      onVideoSnapshot?.(data);
      return data;
    } catch (err) {
      if (!silent) addToast?.(err.message, "bad", "Failed to load");
      return null;
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [videoId, session, addToast, onVideoSnapshot]);

  useEffect(() => {
    if (!videoId) return;

    let cancelled = false;

    const schedule = (delayMs) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(async () => {
        const data = await load(true);
        if (cancelled) {
          return;
        }

        const nextDelay = data?.status === "processing" ? PROCESSING_POLL_MS : IDLE_POLL_MS;
        schedule(nextDelay);
      }, delayMs);
    };

    setLoading(true);
    setVideo(null);
    void load(true).then((data) => {
      if (cancelled) {
        return;
      }

      const nextDelay = data?.status === "processing" ? PROCESSING_POLL_MS : IDLE_POLL_MS;
      schedule(nextDelay);
    });

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [videoId, load]);

  const retry = useCallback(async (stage = "transcode") => {
    try {
      await retryVideo(videoId, { stage }, session);
      addToast?.("Retry queued. Processing will resume shortly.", "ok", "Retry");
      load(true);
    } catch (err) {
      addToast?.(err.message, "bad", "Retry failed");
    }
  }, [videoId, session, addToast, load]);

  return { video, loading, reload: () => load(false), retry };
}
