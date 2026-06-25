import React from "react";

export default function VariantList({ variants = [] }) {
  if (!variants.length) {
    return (
      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        No variants available yet.
      </p>
    );
  }

  return (
    <ul className="variant-list">
      {variants.map((v, i) => (
        <li key={i} className="variant-item">
          <span className="variant-badge">{v.profile ?? `v${i + 1}`}</span>
          <span className="variant-info">
            {v.resolution ?? ""}{v.bitrateKbps ? ` \u00b7 ${v.bitrateKbps}kbps` : ""}
          </span>
          {v.url && (
            <a
              className="variant-link"
              href={v.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Stream &rarr;
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
