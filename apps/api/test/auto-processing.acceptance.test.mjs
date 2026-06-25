import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { buildServer } from "../dist/server.js";

function buildMultipartUpload({ fieldName, filename, contentType, content }) {
  const boundary = `----streamforge-${randomUUID()}`;
  const preamble = [
    `--${boundary}`,
    `Content-Disposition: form-data; name=\"${fieldName}\"; filename=\"${filename}\"`,
    `Content-Type: ${contentType}`,
    "",
    ""
  ].join("\r\n");
  const epilogue = `\r\n--${boundary}--\r\n`;

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat([Buffer.from(preamble, "utf8"), content, Buffer.from(epilogue, "utf8")])
  };
}

async function waitForReady(app, videoId, headers) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: "GET",
      url: `/videos/${videoId}/status`,
      headers
    });

    assert.equal(response.statusCode, 200, response.body);
    const payload = response.json();
    if (payload.status === "ready") {
      return payload;
    }

    // Yield so background in-memory workers can advance queued jobs.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Timed out waiting for video to reach ready status");
}

test("in-memory queue auto-processes upload to ready", async (t) => {
  process.env.STREAM_FORGE_AUTH_MODE = "dev";
  process.env.STREAM_FORGE_START_IN_MEMORY_WORKERS = "true";
  delete process.env.STREAM_FORGE_INTERNAL_TOKEN;
  delete process.env.STREAM_FORGE_REDIS_URL;
  delete process.env.STREAM_FORGE_START_WORKERS;

  const app = await buildServer();
  t.after(async () => {
    await app.close();
  });

  const userHeaders = {
    "x-user-id": "e2e-auto-user"
  };

  const uploadBytes = Buffer.from("auto-processing-video-content", "utf8");
  const filename = "auto-ready.mp4";

  const createResponse = await app.inject({
    method: "POST",
    url: "/videos",
    headers: {
      ...userHeaders,
      "content-type": "application/json"
    },
    payload: JSON.stringify({
      filename,
      contentType: "video/mp4",
      sizeBytes: uploadBytes.length,
      tenantId: "tenant-auto"
    })
  });

  assert.equal(createResponse.statusCode, 201, createResponse.body);
  const created = createResponse.json();

  const uploadPayload = buildMultipartUpload({
    fieldName: "file",
    filename,
    contentType: "video/mp4",
    content: uploadBytes
  });

  const uploadResponse = await app.inject({
    method: "POST",
    url: `/videos/${created.videoId}/upload`,
    headers: {
      ...userHeaders,
      "content-type": uploadPayload.contentType
    },
    payload: uploadPayload.body
  });

  assert.equal(uploadResponse.statusCode, 202, uploadResponse.body);

  const ready = await waitForReady(app, created.videoId, userHeaders);
  assert.equal(ready.status, "ready");
  assert.equal(ready.activeStage, "notification");

  const detailsResponse = await app.inject({
    method: "GET",
    url: `/videos/${created.videoId}`,
    headers: userHeaders
  });

  assert.equal(detailsResponse.statusCode, 200, detailsResponse.body);
  const details = detailsResponse.json();
  assert.ok(Array.isArray(details.variants));
  assert.ok(details.variants.length > 0);
  assert.ok(details.transcript);
  assert.ok(Array.isArray(details.transcript.segments));
});
