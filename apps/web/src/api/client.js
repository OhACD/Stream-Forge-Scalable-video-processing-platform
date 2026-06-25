const API_BASE = "/api";

function buildHeaders(session, withContentType = true) {
  const h = new Headers();
  if (withContentType) h.set("content-type", "application/json");
  if (session.authToken) {
    h.set("authorization", `Bearer ${session.authToken}`);
  } else {
    h.set("x-user-id", session.userId);
  }
  return h;
}

async function request(path, options = {}, session) {
  const hasBody = options.body !== undefined && options.body !== null;
  const isFormData = options.body instanceof FormData;
  const headers = buildHeaders(session, hasBody && !isFormData);
  const extraHeaders = new Headers(options.headers ?? {});
  extraHeaders.forEach((value, key) => headers.set(key, value));

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  let data = null;
  try { data = await res.json(); } catch { data = null; }

  if (!res.ok) {
    const err = new Error(
      data?.error?.message ?? `Request failed (${res.status})`
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const listVideos = (session) =>
  request("/videos?limit=24", {}, session);

export const getVideo = (id, session) =>
  request(`/videos/${id}`, {}, session);

export const createVideo = (payload, session) =>
  request("/videos", { method: "POST", body: JSON.stringify(payload) }, session);

export const deleteVideo = (id, session) =>
  request(`/videos/${id}`, {
    method: "DELETE",
    headers: { "idempotency-key": `delete-${id}` },
  }, session);

export const retryVideo = (id, payload, session) =>
  request(`/videos/${id}/retry`, {
    method: "POST",
    body: JSON.stringify(payload),
  }, session);

export function uploadVideoFile(videoId, file, session, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/videos/${videoId}/upload`);

    if (session.authToken) {
      xhr.setRequestHeader("authorization", `Bearer ${session.authToken}`);
    } else {
      xhr.setRequestHeader("x-user-id", session.userId);
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve(null); }
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try { msg = JSON.parse(xhr.responseText)?.error?.message ?? msg; } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(fd);
  });
}

export async function sha256ForFile(file) {
  const MAX = 200 * 1024 * 1024;
  if (file.size > MAX) return null;
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return "sha256:" + Array.from(new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0")
  ).join("");
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric",
  });
}

export function formatDuration(ms) {
  if (!ms) return "—";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${m}:${String(s).padStart(2,"0")}`;
}
