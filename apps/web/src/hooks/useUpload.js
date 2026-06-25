import { useState, useCallback } from "react";
import { createVideo, uploadVideoFile, sha256ForFile } from "../api/client.js";

const IDLE = { phase: "idle", progress: 0, error: null, videoId: null };
// phases: idle | hashing | creating | uploading | done | error

export function useUpload({ session, onEvent, onSuccess }) {
  const [uploadState, setUploadState] = useState(IDLE);

  const startUpload = useCallback(async ({ file, title }) => {
    setUploadState({ ...IDLE, phase: "hashing" });
    onEvent?.("Computing checksum\u2026", "info");
    try {
      const checksum = await sha256ForFile(file);

      setUploadState((s) => ({ ...s, phase: "creating" }));
      onEvent?.("Creating video record\u2026", "info");

      const intent = await createVideo({
        filename:        file.name,
        contentType:     file.type || "video/mp4",
        sizeBytes:       file.size,
        tenantId:        session.tenantId,
        checksumSha256:  checksum,
        title:           title || file.name,
      }, session);

      setUploadState((s) => ({ ...s, phase: "uploading", videoId: intent.videoId }));
      onEvent?.(`Uploading \u201c${title || file.name}\u201d\u2026`, "info");

      await uploadVideoFile(
        intent.videoId,
        file,
        session,
        (pct) => setUploadState((s) => ({ ...s, progress: pct }))
      );

      setUploadState((s) => ({ ...s, phase: "done", progress: 100 }));
      onEvent?.(`\u201c${title || file.name}\u201d uploaded and queued for processing.`, "ok");
      onSuccess?.();
    } catch (err) {
      setUploadState((s) => ({ ...s, phase: "error", error: err.message }));
      onEvent?.(`Upload failed: ${err.message}`, "bad");
    }
  }, [session, onEvent, onSuccess]);

  const resetUpload = useCallback(() => setUploadState(IDLE), []);

  return { uploadState, startUpload, resetUpload };
}
