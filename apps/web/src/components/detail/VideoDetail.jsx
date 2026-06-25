import React from "react";
import { useVideoDetail } from "../../hooks/useVideoDetail.js";
import PipelineTimeline from "./PipelineTimeline.jsx";
import ThumbnailGallery from "./ThumbnailGallery.jsx";
import VariantList from "./VariantList.jsx";
import StatusBadge from "../library/StatusBadge.jsx";
import Spinner from "../common/Spinner.jsx";
import { IconX, IconRefresh, IconTrash, IconAlertCircle } from "../Icons.jsx";
import { formatDate, formatDuration } from "../../api/client.js";

export default function VideoDetail({
  videoId,
  session,
  onClose,
  onDelete,
  addToast,
  onActivityEvent,
  onVideoSnapshot
}) {
  const { video, loading, reload, retry } = useVideoDetail({
    videoId,
    session,
    addToast,
    onVideoSnapshot
  });

  function handleDelete() {
    if (!window.confirm("Delete this video? This action marks it as deleted.")) return;
    onDelete?.(videoId);
    onActivityEvent?.(`Deleted video ${videoId}.`, "warn");
  }

  async function handleRetry() {
    onActivityEvent?.(`Retry requested for ${videoId}.`, "info");
    await retry();
  }

  const meta = video?.metadata ?? {};
  const assets = video?.assets ?? {};
  const thumbnails = assets.thumbnailUrls ?? [];
  const variants = assets.variantUrls ?? [];

  return (
    <aside className="detail-panel" aria-label="Video details">
      {/* Header */}
      <div className="detail-header">
        <div className="detail-header-info">
          <p className="detail-title">
            {loading ? "Loading\u2026" : (video?.title ?? video?.videoId ?? videoId)}
          </p>
          <p className="detail-subtitle">
            {video ? (
              <StatusBadge status={video.status} />
            ) : (
              <span style={{ color: "var(--text-muted)", fontSize: "0.76rem" }}>{videoId}</span>
            )}
          </p>
        </div>
        <button
          className="detail-close-btn"
          onClick={onClose}
          aria-label="Close detail panel"
        >
          <IconX size={14} />
        </button>
      </div>

      {loading && (
        <div className="loading-center">
          <Spinner size="lg" />
        </div>
      )}

      {!loading && !video && (
        <div className="detail-section" style={{ textAlign: "center", padding: "40px 20px" }}>
          <IconAlertCircle size={32} style={{ color: "var(--bad)", marginBottom: 12 }} />
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            Could not load video details.
          </p>
          <button className="btn btn-ghost btn-sm" onClick={reload} style={{ marginTop: 12 }}>
            <IconRefresh size={13} /> Retry
          </button>
        </div>
      )}

      {!loading && video && (
        <>
          {/* Pipeline */}
          <div className="detail-section">
            <p className="detail-section-label">Pipeline</p>
            <PipelineTimeline video={video} />
          </div>

          {/* Metadata */}
          <div className="detail-section">
            <p className="detail-section-label">Metadata</p>
            <div className="meta-grid">
              <div className="meta-item">
                <p className="meta-label">Duration</p>
                <p className="meta-value">{formatDuration(meta.durationMs)}</p>
              </div>
              <div className="meta-item">
                <p className="meta-label">Resolution</p>
                <p className="meta-value">
                  {meta.width && meta.height ? `${meta.width}\u00d7${meta.height}` : "\u2014"}
                </p>
              </div>
              <div className="meta-item">
                <p className="meta-label">Codec</p>
                <p className="meta-value">{meta.sourceCodec ?? "\u2014"}</p>
              </div>
              <div className="meta-item">
                <p className="meta-label">Created</p>
                <p className="meta-value">{formatDate(video.createdAt)}</p>
              </div>
              <div className="meta-item" style={{ gridColumn: "1 / -1" }}>
                <p className="meta-label">Video ID</p>
                <p className="meta-value" style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
                  {video.videoId}
                </p>
              </div>
            </div>
          </div>

          {/* Thumbnails */}
          {thumbnails.length > 0 && (
            <div className="detail-section">
              <p className="detail-section-label">Thumbnails</p>
              <ThumbnailGallery thumbnails={thumbnails} />
            </div>
          )}

          {/* Variants */}
          {variants.length > 0 && (
            <div className="detail-section">
              <p className="detail-section-label">Variants</p>
              <VariantList variants={variants} />
            </div>
          )}

          {/* Actions */}
          <div className="detail-section">
            <p className="detail-section-label">Actions</p>
            <div className="actions-row">
              <button className="btn btn-ghost btn-sm" onClick={reload}>
                <IconRefresh size={13} /> Refresh
              </button>
              {(video.status === "failed" || video.status === "processing") && (
                <button className="btn btn-warn btn-sm" onClick={handleRetry}>
                  Retry
                </button>
              )}
              <button
                className="btn btn-danger btn-sm"
                onClick={handleDelete}
                disabled={video.status === "deleted"}
              >
                <IconTrash size={13} /> Delete
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
