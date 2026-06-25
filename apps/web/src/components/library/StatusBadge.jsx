import React from "react";

const STATUS_MAP = {
  ready:           { cls: "ok",     label: "Ready" },
  processing:      { cls: "work",   label: "Processing" },
  upload_pending:  { cls: "queued", label: "Pending upload" },
  queued:          { cls: "queued", label: "Queued" },
  failed:          { cls: "bad",    label: "Failed" },
  deleted:         { cls: "warn",   label: "Deleted" },
};

export default function StatusBadge({ status }) {
  const { cls, label } = STATUS_MAP[status] ?? { cls: "queued", label: status ?? "Unknown" };
  return (
    <span className={`status-badge ${cls}`}>
      <span className="status-badge-dot" />
      {label}
    </span>
  );
}
