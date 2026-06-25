import React from "react";

export default function ThumbnailGallery({ thumbnails = [] }) {
  if (!thumbnails.length) {
    return (
      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        No thumbnails available yet.
      </p>
    );
  }

  return (
    <div className="thumb-grid">
      {thumbnails.map((t, i) => (
        <a
          key={i}
          className="thumb-item"
          href={t.url}
          target="_blank"
          rel="noopener noreferrer"
          title={t.type ?? `Thumbnail ${i + 1}`}
        >
          <img
            src={t.url}
            alt={t.type ?? `Thumbnail ${i + 1}`}
            loading="lazy"
          />
        </a>
      ))}
    </div>
  );
}
