import React from "react";
import { IconCheck, IconAlertCircle, IconX, IconInfo } from "../Icons.jsx";

function ToastIcon({ type }) {
  if (type === "ok")   return <IconCheck size={16} />;
  if (type === "bad")  return <IconAlertCircle size={16} />;
  if (type === "warn") return <IconAlertCircle size={16} />;
  return <IconInfo size={16} />;
}

export default function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`} role="alert">
          <div className="toast-icon-wrap">
            <ToastIcon type={t.type} />
          </div>
          <div className="toast-body">
            {t.title && <p className="toast-title">{t.title}</p>}
            <p className="toast-message">{t.message}</p>
          </div>
          <button
            className="toast-dismiss"
            onClick={() => onDismiss(t.id)}
            aria-label="Dismiss notification"
          >
            <IconX size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
