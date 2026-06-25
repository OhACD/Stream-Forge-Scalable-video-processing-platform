import React from "react";
import { IconSpark, IconSettings } from "../Icons.jsx";

export default function TopBar({ session, onSettingsClick, onLogoClick }) {
  const initials = (session?.userId ?? "U")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="topbar">
      <div className="topbar-logo" onClick={onLogoClick} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onLogoClick?.()}>
        <div className="topbar-logomark">
          <IconSpark size={16} style={{ color: "white" }} />
        </div>
        <span className="topbar-wordmark">
          Stream<span>Forge</span>
        </span>
      </div>

      <div className="topbar-spacer" />

      <div className="topbar-end">
        <button className="topbar-chip" onClick={onSettingsClick} aria-label="Settings">
          <IconSettings size={15} />
          <span style={{ fontWeight: 500 }}>Settings</span>
        </button>
        <div className="topbar-avatar" aria-label={`User ${session?.userId}`}>
          {initials}
        </div>
      </div>
    </header>
  );
}
