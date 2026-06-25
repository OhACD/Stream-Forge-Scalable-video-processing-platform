import React from "react";
import VideoCard from "./VideoCard.jsx";
import EmptyState from "../common/EmptyState.jsx";
import { IconFilm, IconRefresh, IconPlus } from "../Icons.jsx";

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-thumb" />
      <div className="skeleton-body">
        <div className="skeleton-line" />
        <div className="skeleton-line short" />
      </div>
    </div>
  );
}

export default function VideoGrid({
  videos,
  loading,
  selectedVideoId,
  onSelect,
  onRefresh,
  onUploadClick,
}) {
  const total = videos.length;
  const processing = videos.filter((v) => v.status === "processing").length;

  return (
    <div className="library-view">
      <div className="library-header">
        <div className="library-heading">
          <h1>Library</h1>
          <p>
            {loading
              ? "Loading videos\u2026"
              : `${total} video${total !== 1 ? "s" : ""}${processing > 0 ? ` \u2022 ${processing} processing` : ""}`
            }
          </p>
        </div>
        <div className="library-actions">
          <button className="btn btn-ghost btn-sm" onClick={onRefresh} aria-label="Refresh library">
            <IconRefresh size={14} /> Refresh
          </button>
          <button className="btn btn-primary btn-sm" onClick={onUploadClick}>
            <IconPlus size={14} /> Upload
          </button>
        </div>
      </div>

      {loading ? (
        <div className="skeleton-grid">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : videos.length === 0 ? (
        <EmptyState
          icon={<IconFilm size={56} />}
          title="No videos yet"
          message="Upload your first video to start the processing pipeline."
          action={
            <button className="btn btn-primary" onClick={onUploadClick}>
              <IconPlus size={14} /> Upload a video
            </button>
          }
        />
      ) : (
        <div className="video-grid">
          {videos.map((v) => (
            <VideoCard
              key={v.videoId}
              video={v}
              selected={v.videoId === selectedVideoId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
