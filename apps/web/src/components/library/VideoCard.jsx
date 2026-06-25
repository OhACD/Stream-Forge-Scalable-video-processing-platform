import React from "react";
import StatusBadge from "./StatusBadge.jsx";
import { IconFilm, IconPlay } from "../Icons.jsx";
import { formatDate } from "../../api/client.js";

function ProgressRing({ pct = 0 }) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  return (
    <div className="video-card-progress-ring">
      <svg width="52" height="52">
        <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
        <circle
          cx="26" cy="26" r={r}
          fill="none"
          stroke="var(--work)"
          strokeWidth="3"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 26 26)"
          className="progress-ring-track"
        />
      </svg>
      <span style={{ position: "absolute", fontSize: "0.72rem", fontWeight: 700, color: "white" }}>
        {pct}%
      </span>
    </div>
  );
}

function CardThumb({ video }) {
  const thumbUrl = video.assets?.thumbnailUrls?.[0]?.url ?? null;
  const isProcessing = video.status === "processing";
  const progress = video.progress ?? video.progressPercent ?? 0;

  if (thumbUrl) {
    return (
      <>
        <img src={thumbUrl} alt={`Thumbnail for ${video.title ?? video.videoId}`} loading="lazy" />
        {isProcessing && <ProgressRing pct={progress} />}
      </>
    );
  }

  return (
    <div className="video-card-placeholder">
      <IconFilm size={36} style={{ opacity: 0.25 }} />
      {isProcessing ? (
        <ProgressRing pct={progress} />
      ) : (
        <span className="video-card-placeholder-stage">
          {(video.processingStage ?? video.activeStage ?? video.status ?? "").replace(/_/g, " ")}
        </span>
      )}
    </div>
  );
}

export default function VideoCard({ video, selected, onSelect }) {
  return (
    <article
      className={`video-card${selected ? " selected" : ""}`}
      onClick={() => onSelect(video.videoId)}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onKeyDown={(e) => e.key === "Enter" && onSelect(video.videoId)}
    >
      <div className="video-card-thumb">
        <CardThumb video={video} />
        <div className="video-card-status">
          <StatusBadge status={video.status} />
        </div>
        <div className="video-card-hover-overlay">
          <button
            className="btn btn-sm"
            style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "none", backdropFilter: "blur(8px)" }}
            onClick={(e) => { e.stopPropagation(); onSelect(video.videoId); }}
          >
            <IconPlay size={12} /> View
          </button>
        </div>
      </div>
      <div className="video-card-body">
        <div className="video-card-title">
          {video.title ?? video.videoId}
        </div>
        <div className="video-card-footer">
          <span className="video-card-date">{formatDate(video.createdAt)}</span>
        </div>
      </div>
    </article>
  );
}
