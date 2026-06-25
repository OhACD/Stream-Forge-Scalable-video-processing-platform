import "./styles.css";

const SESSION_STORAGE_KEY = "streamforge-session";
const LIST_REFRESH_MS = 10_000;
const DETAILS_REFRESH_MS = 6_000;
const MAX_CHECKSUM_BYTES = 200 * 1024 * 1024;

const app = document.querySelector("#app");

app.innerHTML = `
  <main class="shell">
    <header class="hero">
      <div class="eyebrow">StreamForge Studio</div>
      <h1>Video workspace for real users, not operators.</h1>
      <p>Upload, preview thumbnails, track stage progress, and manage the full lifecycle from one place.</p>
    </header>

    <section class="panel session-panel" aria-label="Session setup">
      <div class="panel-headline">
        <h2>Session</h2>
        <p>Use bearer token for Firebase flows. Dev fallback uses user header when token is empty.</p>
      </div>
      <form id="session-form" class="session-grid">
        <label>
          <span>User ID</span>
          <input id="user-id" autocomplete="username" />
        </label>
        <label>
          <span>Tenant ID</span>
          <input id="tenant-id" autocomplete="organization" />
        </label>
        <label class="token-field">
          <span>Bearer token (optional)</span>
          <input id="auth-token" type="password" placeholder="eyJhbGciOi..." />
        </label>
        <button id="save-session" class="ghost" type="submit">Save session</button>
      </form>
    </section>

    <section class="workspace-grid">
      <article class="panel upload-panel" aria-label="Upload">
        <div class="panel-headline">
          <h2>Upload</h2>
          <p>Create an intent, then upload bytes and start processing.</p>
        </div>
        <form id="upload-form" class="upload-grid">
          <label class="file-label">
            <span>Video file</span>
            <input id="file-upload" type="file" accept="video/*" />
          </label>
          <label>
            <span>Filename</span>
            <input id="filename" placeholder="my-video.mp4" required />
          </label>
          <label>
            <span>Content type</span>
            <input id="content-type" placeholder="video/mp4" required />
          </label>
          <label>
            <span>Size bytes</span>
            <input id="size-bytes" type="number" min="1" required />
          </label>
          <div class="upload-actions">
            <button id="upload-submit" class="primary" type="submit">Upload video</button>
            <button id="refresh-list" class="ghost" type="button">Refresh</button>
          </div>
        </form>

        <div id="upload-progress" class="progress-wrap hidden" aria-live="polite">
          <div class="progress-meta">
            <strong>Uploading</strong>
            <span id="upload-progress-label">0%</span>
          </div>
          <div id="upload-progressbar" class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
            <div id="upload-progress-fill" class="progress-fill"></div>
          </div>
        </div>

        <div id="upload-summary" class="summary-card">No upload submitted yet.</div>
      </article>

      <article class="panel library-panel" aria-label="Video library">
        <div class="panel-headline">
          <h2>Library</h2>
          <p id="library-meta">Loading videos...</p>
        </div>
        <div id="video-library" class="video-grid"></div>
      </article>
    </section>

    <section class="workspace-grid details-layout">
      <article class="panel details-panel" aria-label="Selected video">
        <div class="panel-headline">
          <h2 id="selected-title">Select a video</h2>
          <p id="selected-subtitle">Choose a video from the library to inspect outputs.</p>
        </div>

        <ol id="stage-timeline" class="stage-timeline"></ol>

        <div class="details-meta" id="details-meta"></div>

        <section>
          <h3>Thumbnails</h3>
          <div id="thumbnail-gallery" class="thumb-grid"></div>
        </section>

        <section>
          <h3>Variants</h3>
          <ul id="variant-list" class="link-list"></ul>
        </section>

        <section>
          <h3>Actions</h3>
          <div class="action-row">
            <button id="poll-selected" class="ghost" type="button">Refresh status</button>
            <button id="load-details" class="ghost" type="button">Reload details</button>
            <button id="retry-selected" class="warn" type="button">Retry transcode</button>
            <button id="delete-selected" class="danger" type="button">Delete video</button>
          </div>
        </section>
      </article>

      <article class="panel activity-panel" aria-label="Updates">
        <div class="panel-headline">
          <h2>Live updates</h2>
          <p>Auto refresh is active while this page is open.</p>
        </div>
        <ul id="activity-log" class="activity-log"></ul>
      </article>
    </section>
  </main>
`;

const userIdInput = document.querySelector("#user-id");
const tenantIdInput = document.querySelector("#tenant-id");
const authTokenInput = document.querySelector("#auth-token");
const sessionForm = document.querySelector("#session-form");

const uploadForm = document.querySelector("#upload-form");
const uploadSubmitButton = document.querySelector("#upload-submit");
const uploadSummary = document.querySelector("#upload-summary");
const fileUploadInput = document.querySelector("#file-upload");
const filenameInput = document.querySelector("#filename");
const contentTypeInput = document.querySelector("#content-type");
const sizeBytesInput = document.querySelector("#size-bytes");
const refreshListButton = document.querySelector("#refresh-list");

const uploadProgressWrap = document.querySelector("#upload-progress");
const uploadProgressLabel = document.querySelector("#upload-progress-label");
const uploadProgressbar = document.querySelector("#upload-progressbar");
const uploadProgressFill = document.querySelector("#upload-progress-fill");

const libraryMeta = document.querySelector("#library-meta");
const videoLibrary = document.querySelector("#video-library");

const selectedTitle = document.querySelector("#selected-title");
const selectedSubtitle = document.querySelector("#selected-subtitle");
const stageTimeline = document.querySelector("#stage-timeline");
const detailsMeta = document.querySelector("#details-meta");
const thumbnailGallery = document.querySelector("#thumbnail-gallery");
const variantList = document.querySelector("#variant-list");

const pollSelectedButton = document.querySelector("#poll-selected");
const loadDetailsButton = document.querySelector("#load-details");
const retrySelectedButton = document.querySelector("#retry-selected");
const deleteSelectedButton = document.querySelector("#delete-selected");

const activityLog = document.querySelector("#activity-log");

const state = {
  session: {
    userId: "user-1",
    tenantId: "tenant-a",
    authToken: ""
  },
  videos: [],
  selectedVideoId: null,
  selectedVideoDetails: null,
  previewByVideoId: new Map(),
  refresh: {
    listInFlight: false,
    detailInFlight: false,
    listSeq: 0,
    detailSeq: 0
  },
  upload: {
    inFlight: false,
    progressPercent: 0,
    selectedFile: null
  },
  activity: []
};

const apiBase = "/api";

function nowTimeLabel() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function logActivity(message, tone = "info") {
  state.activity.unshift({ message, tone, at: nowTimeLabel() });
  state.activity = state.activity.slice(0, 30);
  renderActivity();
}

function renderActivity() {
  if (state.activity.length === 0) {
    activityLog.innerHTML = '<li class="activity-item">No activity yet.</li>';
    return;
  }

  activityLog.innerHTML = state.activity
    .map((item) => `<li class="activity-item ${item.tone}"><span>${item.at}</span><p>${item.message}</p></li>`)
    .join("");
}

function applySessionToInputs() {
  userIdInput.value = state.session.userId;
  tenantIdInput.value = state.session.tenantId;
  authTokenInput.value = state.session.authToken;
}

function loadSessionFromStorage() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    if (typeof parsed.userId === "string" && parsed.userId.length > 0) {
      state.session.userId = parsed.userId;
    }
    if (typeof parsed.tenantId === "string" && parsed.tenantId.length > 0) {
      state.session.tenantId = parsed.tenantId;
    }
    if (typeof parsed.authToken === "string") {
      state.session.authToken = parsed.authToken;
    }
  } catch {
    logActivity("Could not load saved session. Using defaults.", "warn");
  }
}

function persistSession() {
  localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify({
      userId: state.session.userId,
      tenantId: state.session.tenantId,
      authToken: state.session.authToken
    })
  );
}

function syncSessionFromInputs() {
  state.session.userId = userIdInput.value.trim() || "user-1";
  state.session.tenantId = tenantIdInput.value.trim() || "tenant-a";
  state.session.authToken = authTokenInput.value.trim();
}

function applyAuthHeaders(headers) {
  if (state.session.authToken.length > 0) {
    headers.set("authorization", `Bearer ${state.session.authToken}`);
    return;
  }

  headers.set("x-user-id", state.session.userId);
}

function parseErrorMessage(error, fallback) {
  if (error?.payload?.error?.message) {
    return error.payload.error.message;
  }

  if (error?.message) {
    return error.message;
  }

  return fallback;
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  const hasBody = options.body !== undefined && options.body !== null;
  if (hasBody && !(options.body instanceof FormData)) {
    headers.set("content-type", headers.get("content-type") ?? "application/json");
  }
  applyAuthHeaders(headers);

  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const error = new Error(body?.error?.message ?? `Request failed (${response.status})`);
    error.payload = body;
    error.statusCode = response.status;
    throw error;
  }

  return body;
}

function statusClass(status) {
  if (status === "ready") return "ok";
  if (status === "failed") return "bad";
  if (status === "processing") return "work";
  if (status === "deleted") return "muted";
  return "queued";
}

function normalizeStageLabel(stage) {
  return (stage ?? "upload").replaceAll("_", " ");
}

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256ForFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return `sha256:${toHex(new Uint8Array(digest))}`;
}

function setUploadProgress(progressPercent, visible) {
  const clamped = Math.max(0, Math.min(100, Math.round(progressPercent)));
  state.upload.progressPercent = clamped;

  if (visible) {
    uploadProgressWrap.classList.remove("hidden");
  } else {
    uploadProgressWrap.classList.add("hidden");
  }

  uploadProgressLabel.textContent = `${clamped}%`;
  uploadProgressFill.style.width = `${clamped}%`;
  uploadProgressbar.setAttribute("aria-valuenow", String(clamped));
}

function setUploadBusy(inFlight) {
  state.upload.inFlight = inFlight;
  uploadSubmitButton.disabled = inFlight;
  uploadSubmitButton.textContent = inFlight ? "Uploading..." : "Upload video";
}

function renderLibrary() {
  libraryMeta.textContent = `${state.videos.length} video${state.videos.length === 1 ? "" : "s"} in library`;

  if (state.videos.length === 0) {
    videoLibrary.innerHTML = '<div class="empty-state">No videos yet. Upload your first video to begin processing.</div>';
    return;
  }

  videoLibrary.innerHTML = state.videos
    .map((video) => {
      const preview = state.previewByVideoId.get(video.videoId) ?? "";
      const selected = state.selectedVideoId === video.videoId ? "selected" : "";
      const progress = Number.isFinite(video.progressPercent) ? video.progressPercent : 0;

      return `
        <article class="video-card ${selected}" data-video-id="${video.videoId}">
          <div class="card-thumb">
            ${preview
              ? `<img src="${preview}" alt="Thumbnail preview for ${video.videoId}" loading="lazy" />`
              : `<div class="thumb-placeholder">${normalizeStageLabel(video.activeStage)}</div>`}
          </div>
          <div class="card-body">
            <div class="card-title-row">
              <h3>${video.videoId}</h3>
              <span class="status-pill ${statusClass(video.status)}">${video.status}</span>
            </div>
            <p>Stage: ${normalizeStageLabel(video.activeStage)}</p>
            <div class="mini-progress">
              <div style="width:${Math.max(0, Math.min(100, progress))}%"></div>
            </div>
            <small>Updated ${new Date(video.updatedAt).toLocaleString()}</small>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderStageTimeline() {
  const stages = ["upload", "metadata", "thumbnail", "transcode", "notification", "ready"];
  const selected = state.videos.find((video) => video.videoId === state.selectedVideoId) ?? null;
  const activeStage = selected?.activeStage ?? "upload";
  const activeIndex = stages.indexOf(activeStage);

  stageTimeline.innerHTML = stages
    .map((stage, index) => {
      let cls = "pending";
      if (selected?.status === "ready") {
        cls = "done";
      } else if (selected?.status === "failed" && stage === activeStage) {
        cls = "failed";
      } else if (index < activeIndex) {
        cls = "done";
      } else if (index === activeIndex) {
        cls = "active";
      }

      return `<li class="stage ${cls}"><span>${stage}</span></li>`;
    })
    .join("");
}

function renderDetails() {
  const details = state.selectedVideoDetails;
  if (!details) {
    selectedTitle.textContent = "Select a video";
    selectedSubtitle.textContent = "Pick a card from the library to load metadata, thumbnails, and variants.";
    detailsMeta.innerHTML = "";
    thumbnailGallery.innerHTML = '<div class="empty-state">No thumbnails available.</div>';
    variantList.innerHTML = '<li class="muted-row">No variants available.</li>';
    renderStageTimeline();
    return;
  }

  selectedTitle.textContent = details.videoId;
  selectedSubtitle.textContent = `${details.status} at ${normalizeStageLabel(details.activeStage)} • ${details.progressPercent}% complete`;

  detailsMeta.innerHTML = `
    <div><strong>Created</strong><span>${new Date(details.createdAt).toLocaleString()}</span></div>
    <div><strong>Updated</strong><span>${new Date(details.updatedAt).toLocaleString()}</span></div>
    <div><strong>Correlation</strong><span>${details.correlationId}</span></div>
    <div><strong>Source</strong><span>${details.objectPath}</span></div>
  `;

  const thumbs = details.assets?.thumbnailUrls ?? [];
  if (thumbs.length === 0) {
    thumbnailGallery.innerHTML = '<div class="empty-state">No thumbnails yet.</div>';
  } else {
    thumbnailGallery.innerHTML = thumbs
      .map((thumb) => `
        <a class="thumb-card" href="${thumb.url}" target="_blank" rel="noreferrer">
          <img src="${thumb.url}" alt="${thumb.type} thumbnail" loading="lazy" />
          <span>${thumb.type}</span>
        </a>
      `)
      .join("");
  }

  const variants = details.assets?.variantUrls ?? [];
  if (variants.length === 0) {
    variantList.innerHTML = '<li class="muted-row">No variants yet.</li>';
  } else {
    variantList.innerHTML = variants
      .map((variant) => `
        <li>
          <a href="${variant.url}" target="_blank" rel="noreferrer">${variant.profile} stream</a>
          <span>${variant.objectPath}</span>
        </li>
      `)
      .join("");
  }

  renderStageTimeline();
}

async function refreshCardPreviews() {
  const readyTargets = state.videos
    .filter((video) => video.status === "ready" || video.status === "processing")
    .slice(0, 6);

  for (const video of readyTargets) {
    if (state.previewByVideoId.has(video.videoId)) {
      continue;
    }

    try {
      const details = await apiRequest(`/videos/${video.videoId}`, { method: "GET" });
      const previewUrl = details.assets?.thumbnailUrls?.[0]?.url ?? details.assets?.sourceUrl;
      if (previewUrl) {
        state.previewByVideoId.set(video.videoId, previewUrl);
      }
    } catch {
      // Skip preview fetch failures silently; main UX still works with placeholders.
    }
  }

  renderLibrary();
}

async function refreshVideos(options = {}) {
  if (state.refresh.listInFlight) {
    return;
  }

  const silent = Boolean(options.silent);
  state.refresh.listInFlight = true;
  const seq = state.refresh.listSeq + 1;
  state.refresh.listSeq = seq;

  try {
    const data = await apiRequest("/videos?limit=24", { method: "GET" });
    if (seq !== state.refresh.listSeq) {
      return;
    }

    state.videos = data.items ?? [];

    if (state.videos.length > 0 && !state.selectedVideoId) {
      state.selectedVideoId = state.videos[0].videoId;
    }
    if (!state.videos.some((video) => video.videoId === state.selectedVideoId)) {
      state.selectedVideoId = state.videos[0]?.videoId ?? null;
      state.selectedVideoDetails = null;
    }

    renderLibrary();
    renderDetails();
    void refreshCardPreviews();

    if (!silent) {
      logActivity("Library refreshed.", "ok");
    }
  } catch (error) {
    if (!silent) {
      logActivity(parseErrorMessage(error, "Could not refresh library."), "bad");
    }
  } finally {
    state.refresh.listInFlight = false;
  }
}

async function loadSelectedDetails(options = {}) {
  if (!state.selectedVideoId || state.refresh.detailInFlight) {
    return;
  }

  const silent = Boolean(options.silent);
  state.refresh.detailInFlight = true;
  const seq = state.refresh.detailSeq + 1;
  state.refresh.detailSeq = seq;

  try {
    const details = await apiRequest(`/videos/${state.selectedVideoId}`, { method: "GET" });
    if (seq !== state.refresh.detailSeq) {
      return;
    }

    state.selectedVideoDetails = details;
    const previewUrl = details.assets?.thumbnailUrls?.[0]?.url ?? details.assets?.sourceUrl;
    if (previewUrl) {
      state.previewByVideoId.set(details.videoId, previewUrl);
    }

    renderLibrary();
    renderDetails();
    if (!silent) {
      logActivity(`Loaded details for ${details.videoId}.`, "ok");
    }
  } catch (error) {
    if (!silent) {
      logActivity(parseErrorMessage(error, "Could not load selected video."), "bad");
    }
  } finally {
    state.refresh.detailInFlight = false;
  }
}

function currentSelectedVideo() {
  if (!state.selectedVideoId) {
    return null;
  }
  return state.videos.find((video) => video.videoId === state.selectedVideoId) ?? null;
}

async function retrySelected() {
  const selected = currentSelectedVideo();
  if (!selected) {
    logActivity("Select a video to retry.", "warn");
    return;
  }

  try {
    await apiRequest(`/videos/${selected.videoId}/retry`, {
      method: "POST",
      body: JSON.stringify({ stage: "transcode" })
    });
    logActivity(`Retry requested for ${selected.videoId}.`, "ok");
    await refreshVideos({ silent: true });
    await loadSelectedDetails({ silent: true });
  } catch (error) {
    logActivity(parseErrorMessage(error, "Retry failed."), "bad");
  }
}

async function deleteSelected() {
  const selected = currentSelectedVideo();
  if (!selected) {
    logActivity("Select a video to delete.", "warn");
    return;
  }

  const confirmed = window.confirm(`Delete ${selected.videoId}? This marks it as deleted.`);
  if (!confirmed) {
    return;
  }

  try {
    await apiRequest(`/videos/${selected.videoId}`, {
      method: "DELETE",
      headers: {
        "idempotency-key": `delete-${selected.videoId}`
      }
    });

    state.previewByVideoId.delete(selected.videoId);
    state.selectedVideoDetails = null;
    logActivity(`Deleted ${selected.videoId}.`, "ok");
    await refreshVideos({ silent: true });
  } catch (error) {
    logActivity(parseErrorMessage(error, "Delete failed."), "bad");
  }
}

function uploadSourceFile(videoId, file) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiBase}/videos/${videoId}/upload`);
    if (state.session.authToken.length > 0) {
      xhr.setRequestHeader("authorization", `Bearer ${state.session.authToken}`);
    } else {
      xhr.setRequestHeader("x-user-id", state.session.userId);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        setUploadProgress((event.loaded / event.total) * 100, true);
      }
    };

    xhr.onerror = () => {
      reject(new Error("Network error during upload."));
    };

    xhr.onload = () => {
      let parsed = null;
      try {
        parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        parsed = null;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        setUploadProgress(100, false);
        resolve(parsed ?? {});
        return;
      }

      const message = parsed?.error?.message ?? `Upload failed (${xhr.status})`;
      const error = new Error(message);
      error.statusCode = xhr.status;
      error.payload = parsed;
      reject(error);
    };

    setUploadProgress(0, true);
    xhr.send(formData);
  });
}

function onFileSelected() {
  const file = fileUploadInput.files?.[0] ?? null;
  state.upload.selectedFile = file;
  if (!file) {
    return;
  }

  filenameInput.value = file.name;
  contentTypeInput.value = file.type || "video/mp4";
  sizeBytesInput.value = String(file.size);
}

async function submitUpload(event) {
  event.preventDefault();
  if (state.upload.inFlight) {
    return;
  }

  const filename = filenameInput.value.trim();
  const contentType = contentTypeInput.value.trim();
  const sizeBytes = Number.parseInt(sizeBytesInput.value, 10);
  if (!filename || !contentType || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    logActivity("Please provide valid filename, content type, and size.", "warn");
    return;
  }

  const payload = {
    filename,
    contentType,
    sizeBytes,
    tenantId: state.session.tenantId
  };

  try {
    setUploadBusy(true);
    const selectedFile = state.upload.selectedFile;
    if (selectedFile && selectedFile.size <= MAX_CHECKSUM_BYTES) {
      logActivity("Computing checksum...", "info");
      payload.checksumSha256 = await sha256ForFile(selectedFile);
    }
    if (selectedFile && selectedFile.size > MAX_CHECKSUM_BYTES) {
      logActivity("Large file detected. Skipping client checksum to keep UI responsive.", "warn");
    }

    const intent = await apiRequest("/videos", {
      method: "POST",
      headers: {
        "idempotency-key": `create-${filename}-${sizeBytes}`
      },
      body: JSON.stringify(payload)
    });

    state.selectedVideoId = intent.videoId;

    if (!selectedFile) {
      uploadSummary.textContent = `Created upload intent ${intent.videoId}. Select a file to upload bytes.`;
      logActivity(`Created intent ${intent.videoId}.`, "ok");
      await refreshVideos({ silent: true });
      await loadSelectedDetails({ silent: true });
      return;
    }

    const upload = await uploadSourceFile(intent.videoId, selectedFile);
    uploadSummary.textContent = `Uploaded ${selectedFile.name} and queued processing. Next stage: ${upload.activeStage ?? "metadata"}.`;
    logActivity(`Upload complete for ${intent.videoId}.`, "ok");

    await refreshVideos({ silent: true });
    await loadSelectedDetails({ silent: true });
  } catch (error) {
    const message = parseErrorMessage(error, "Upload failed.");
    uploadSummary.textContent = message;
    if (Number(error?.statusCode) === 413) {
      logActivity("Upload rejected as too large (413). Ask support to raise upload limit.", "bad");
    } else {
      logActivity(message, "bad");
    }
  } finally {
    setUploadBusy(false);
    setUploadProgress(0, false);
  }
}

async function pollSelectedStatus() {
  const selected = currentSelectedVideo();
  if (!selected) {
    logActivity("Select a video to poll status.", "warn");
    return;
  }

  try {
    const status = await apiRequest(`/videos/${selected.videoId}/status`, { method: "GET" });
    logActivity(`Status for ${selected.videoId}: ${status.status} at ${normalizeStageLabel(status.activeStage)}.`, "info");
    await refreshVideos({ silent: true });
    await loadSelectedDetails({ silent: true });
  } catch (error) {
    logActivity(parseErrorMessage(error, "Status request failed."), "bad");
  }
}

videoLibrary.addEventListener("click", (event) => {
  const card = event.target.closest(".video-card[data-video-id]");
  if (!card) {
    return;
  }

  state.selectedVideoId = card.getAttribute("data-video-id");
  renderLibrary();
  void loadSelectedDetails();
});

sessionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncSessionFromInputs();
  persistSession();
  logActivity("Session updated.", "ok");
  await refreshVideos({ silent: true });
  await loadSelectedDetails({ silent: true });
});

fileUploadInput.addEventListener("change", onFileSelected);
uploadForm.addEventListener("submit", submitUpload);
refreshListButton.addEventListener("click", () => {
  void refreshVideos();
});
pollSelectedButton.addEventListener("click", () => {
  void pollSelectedStatus();
});
loadDetailsButton.addEventListener("click", () => {
  void loadSelectedDetails();
});
retrySelectedButton.addEventListener("click", () => {
  void retrySelected();
});
deleteSelectedButton.addEventListener("click", () => {
  void deleteSelected();
});

function startAutoRefresh() {
  setInterval(() => {
    void refreshVideos({ silent: true });
  }, LIST_REFRESH_MS);

  setInterval(() => {
    const selected = currentSelectedVideo();
    if (!selected) {
      return;
    }

    if (selected.status === "ready" || selected.status === "deleted") {
      return;
    }

    void loadSelectedDetails({ silent: true });
  }, DETAILS_REFRESH_MS);
}

loadSessionFromStorage();
applySessionToInputs();
renderActivity();
renderLibrary();
renderDetails();
logActivity("Workspace initialized.", "info");
void refreshVideos();
startAutoRefresh();
