import React from "react";

export default function EmptyState({ icon, title, message, action }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <p className="empty-title">{title}</p>
      {message && <p className="empty-message">{message}</p>}
      {action}
    </div>
  );
}
