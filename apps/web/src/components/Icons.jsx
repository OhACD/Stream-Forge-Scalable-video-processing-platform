import React from "react";

const base = { fill: "none", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" };

export const IconFilm = ({ size = 18, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" {...base} {...p}>
    <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
    <line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" />
    <line x1="2" y1="12" x2="22" y2="12" /><line x1="2" y1="7" x2="7" y2="7" />
    <line x1="2" y1="17" x2="7" y2="17" /><line x1="17" y1="17" x2="22" y2="17" />
    <line x1="17" y1="7" x2="22" y2="7" />
  </svg>
);

export const IconUpload = ({ size = 18, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" {...base} {...p}>
    <polyline points="16 16 12 12 8 16" />
    <line x1="12" y1="12" x2="12" y2="21" />
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
  </svg>
);

export const IconActivity = ({ size = 18, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" {...base} {...p}>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

export const IconSettings = ({ size = 18, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

export const IconX = ({ size = 16, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" {...base} {...p}>
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const IconCheck = ({ size = 16, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" {...base} {...p}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const IconAlertCircle = ({ size = 16, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" {...base} {...p}>
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

export const IconRefresh = ({ size = 16, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" {...base} {...p}>
    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

export const IconTrash = ({ size = 16, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" {...base} {...p}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

export const IconPlay = ({ size = 16, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" {...base} {...p}>
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

export const IconPlus = ({ size = 16, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" {...base} {...p}>
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const IconInfo = ({ size = 16, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" {...base} {...p}>
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
);

export const IconVideoOff = ({ size = 40, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" {...base} {...p}>
    <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34" />
    <path d="M23 7l-7 5 7 5V7z" /><line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

export const IconSpark = ({ size = 28, ...p }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} stroke="currentColor" {...base} {...p}>
    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
  </svg>
);
