import React, { useState, useRef, useCallback } from "react";
import { IconUpload, IconFilm, IconCheck, IconAlertCircle, IconRefresh } from "../Icons.jsx";
import { formatBytes } from "../../api/client.js";

const PHASE_LABELS = {
  hashing:   { label: "Computing checksum\u2026",           sub: "This may take a moment for large files." },
  creating:  { label: "Creating video record\u2026",        sub: "Registering with the processing pipeline." },
  uploading: { label: "Uploading file\u2026",               sub: "Transferring bytes to cloud storage." },
  done:      { label: "Upload complete!",                   sub: "Your video is now queued for processing." },
  error:     { label: "Upload failed",                      sub: "" },
};

export default function UploadZone({ uploadState, onUpload, onReset }) {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const fileRef = useRef(null);
  const { phase, progress, error } = uploadState;
  const busy = phase !== "idle" && phase !== "done" && phase !== "error";

  const handleFile = useCallback((f) => {
    setFile(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  }, [title]);

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  function onFileChange(e) {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  }

  function onSubmit(e) {
    e.preventDefault();
    if (!file || busy) return;
    onUpload({ file, title: title.trim() || file.name });
  }

  function handleReset() {
    setFile(null);
    setTitle("");
    onReset();
    if (fileRef.current) fileRef.current.value = "";
  }

  if (phase === "done") {
    return (
      <div className="upload-view">
        <div className="upload-view-heading">
          <h1>Upload</h1>
          <p>Upload complete</p>
        </div>
        <div className="upload-progress-section">
          <div className="upload-done-icon"><IconCheck size={48} /></div>
          <p className="upload-phase-label">Upload complete!</p>
          <p className="upload-phase-sub" style={{ color: "var(--text-muted)" }}>
            Your video is queued for processing. Track progress in Library.
          </p>
          <button className="btn btn-primary" onClick={handleReset} style={{ marginTop: 8 }}>
            Upload another
          </button>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="upload-view">
        <div className="upload-view-heading">
          <h1>Upload</h1>
        </div>
        <div className="upload-progress-section">
          <IconAlertCircle size={48} style={{ color: "var(--bad)" }} />
          <p className="upload-phase-label" style={{ color: "var(--bad)" }}>Upload failed</p>
          <p className="upload-phase-sub" style={{ color: "var(--text-muted)" }}>{error}</p>
          <button className="btn btn-ghost" onClick={handleReset} style={{ marginTop: 8 }}>
            <IconRefresh size={14} /> Try again
          </button>
        </div>
      </div>
    );
  }

  if (busy) {
    const info = PHASE_LABELS[phase] ?? { label: phase, sub: "" };
    return (
      <div className="upload-view">
        <div className="upload-view-heading">
          <h1>Upload</h1>
        </div>
        <div className="upload-progress-section">
          {phase === "uploading" ? (
            <>
              <p className="upload-phase-label">{info.label}</p>
              <p className="upload-phase-sub" style={{ color: "var(--text-muted)" }}>{info.sub}</p>
              <div style={{ width: "100%", marginTop: 8 }}>
                <div className="progress-row">
                  <span>{file?.name}</span>
                  <strong>{progress}%</strong>
                </div>
                <div className="progress-bar-wrap">
                  <div
                    className="progress-bar-fill animated"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="spinner spinner-lg" />
              <p className="upload-phase-label">{info.label}</p>
              <p className="upload-phase-sub" style={{ color: "var(--text-muted)" }}>{info.sub}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="upload-view">
      <div className="upload-view-heading">
        <h1>Upload</h1>
        <p>Drop a video file or click to browse. Processing starts automatically after upload.</p>
      </div>

      {/* Drop zone */}
      <div
        className={`upload-zone${dragOver ? " drag-over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload zone — click or drag a video file"
        onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          onChange={onFileChange}
          aria-label="Select video file"
        />
        <div className="upload-zone-icon">
          <IconUpload size={54} />
        </div>
        <p className="upload-zone-title">
          {dragOver ? "Drop it here" : "Drag & drop a video file"}
        </p>
        <p className="upload-zone-sub">or click to browse your files</p>
        <p className="upload-zone-hint">MP4, MOV, MKV, WebM &mdash; up to 10 GB</p>
      </div>

      {/* File preview */}
      {file && (
        <div className="upload-selected-file">
          <div className="upload-file-icon">
            <IconFilm size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="upload-file-name">{file.name}</p>
            <p className="upload-file-size">{formatBytes(file.size)} &bull; {file.type || "video"}</p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => { e.stopPropagation(); setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
            aria-label="Remove selected file"
          >
            &times;
          </button>
        </div>
      )}

      {/* Form */}
      {file && (
        <form className="upload-form" onSubmit={onSubmit}>
          <div className="form-field">
            <label className="form-label" htmlFor="upload-title">Title</label>
            <input
              id="upload-title"
              className="form-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My video"
            />
          </div>
          <button className="btn btn-primary btn-lg" type="submit" disabled={!file || busy}>
            <IconUpload size={16} /> Start upload
          </button>
        </form>
      )}
    </div>
  );
}
