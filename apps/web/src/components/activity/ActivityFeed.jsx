import React from "react";
import { IconActivity } from "../Icons.jsx";
import EmptyState from "../common/EmptyState.jsx";

export default function ActivityFeed({ entries = [] }) {
  return (
    <div className="activity-view">
      <div className="view-heading">
        <h1>Activity</h1>
        <p>Real-time log of pipeline events, uploads, and system messages.</p>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={<IconActivity size={56} />}
          title="No activity yet"
          message="Upload a video or refresh the library to see events appear here."
        />
      ) : (
        <ul className="activity-list" aria-label="Activity log">
          {entries.map((entry, i) => (
            <li key={i} className={`activity-item ${entry.tone}`}>
              <div className="activity-dot" aria-hidden="true" />
              <div className="activity-body">
                <p className="activity-message">{entry.message}</p>
                <time className="activity-time">{entry.at}</time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
