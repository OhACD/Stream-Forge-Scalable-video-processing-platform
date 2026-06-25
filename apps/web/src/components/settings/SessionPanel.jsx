import React, { useState } from "react";

export default function SessionPanel({ session, onSave }) {
  const [form, setForm] = useState({
    userId:    session.userId,
    tenantId:  session.tenantId,
    authToken: session.authToken,
  });

  function set(k, v) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function onSubmit(e) {
    e.preventDefault();
    onSave({
      userId:    form.userId.trim()    || "user-1",
      tenantId:  form.tenantId.trim()  || "tenant-a",
      authToken: form.authToken.trim(),
    });
  }

  return (
    <div className="settings-view">
      <div className="view-heading">
        <h1>Settings</h1>
        <p>Configure your session credentials for API authentication.</p>
      </div>

      <div className="settings-card">
        <p className="settings-card-title">Session</p>
        <form className="settings-form" onSubmit={onSubmit}>
          <div className="form-field">
            <label className="form-label" htmlFor="setting-user-id">User ID</label>
            <input
              id="setting-user-id"
              className="form-input"
              autoComplete="username"
              value={form.userId}
              onChange={(e) => set("userId", e.target.value)}
              placeholder="user-1"
            />
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="setting-tenant-id">Tenant ID</label>
            <input
              id="setting-tenant-id"
              className="form-input"
              autoComplete="organization"
              value={form.tenantId}
              onChange={(e) => set("tenantId", e.target.value)}
              placeholder="tenant-a"
            />
          </div>
          <div className="form-field">
            <label className="form-label" htmlFor="setting-auth-token">
              Bearer token <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              id="setting-auth-token"
              className="form-input"
              type="password"
              autoComplete="off"
              value={form.authToken}
              onChange={(e) => set("authToken", e.target.value)}
              placeholder="eyJhbGciOi\u2026"
            />
            <span style={{ fontSize: "0.73rem", color: "var(--text-muted)" }}>
              Leave empty to use x-user-id header (dev fallback).
            </span>
          </div>
          <div style={{ paddingTop: 4 }}>
            <button className="btn btn-primary" type="submit">
              Save session
            </button>
          </div>
        </form>
      </div>

      <div className="settings-card" style={{ marginTop: 0 }}>
        <p className="settings-card-title">Current session</p>
        <div className="meta-grid">
          <div className="meta-item">
            <p className="meta-label">User ID</p>
            <p className="meta-value">{session.userId}</p>
          </div>
          <div className="meta-item">
            <p className="meta-label">Tenant ID</p>
            <p className="meta-value">{session.tenantId}</p>
          </div>
          <div className="meta-item" style={{ gridColumn: "1 / -1" }}>
            <p className="meta-label">Auth mode</p>
            <p className="meta-value">{session.authToken ? "Bearer token" : "Dev header (x-user-id)"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
