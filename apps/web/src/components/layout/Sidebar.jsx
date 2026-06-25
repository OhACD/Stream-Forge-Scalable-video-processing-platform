import React from "react";
import { IconFilm, IconUpload, IconActivity, IconSettings } from "../Icons.jsx";

const NAV = [
  { id: "library",  label: "Library",  Icon: IconFilm },
  { id: "upload",   label: "Upload",   Icon: IconUpload },
];

const SECONDARY = [
  { id: "activity", label: "Activity", Icon: IconActivity },
  { id: "settings", label: "Settings", Icon: IconSettings },
];

export default function Sidebar({ activeView, onNavigate, processingCount }) {
  return (
    <nav className="sidebar" aria-label="Main navigation">
      <span className="sidebar-group-label">Studio</span>
      {NAV.map(({ id, label, Icon }) => (
        <button
          key={id}
          className={`sidebar-item${activeView === id ? " active" : ""}`}
          onClick={() => onNavigate(id)}
          aria-current={activeView === id ? "page" : undefined}
        >
          <Icon size={17} className="sidebar-item-icon" />
          {label}
          {id === "library" && processingCount > 0 && (
            <span className="sidebar-badge">{processingCount}</span>
          )}
        </button>
      ))}

      <div className="sidebar-divider" />

      <span className="sidebar-group-label">System</span>
      {SECONDARY.map(({ id, label, Icon }) => (
        <button
          key={id}
          className={`sidebar-item${activeView === id ? " active" : ""}`}
          onClick={() => onNavigate(id)}
          aria-current={activeView === id ? "page" : undefined}
        >
          <Icon size={17} className="sidebar-item-icon" />
          {label}
        </button>
      ))}
    </nav>
  );
}
