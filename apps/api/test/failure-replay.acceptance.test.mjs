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

test("v1 failure and replay acceptance: fail active stage, replay, recover to ready", async (t) => {
  process.env.STREAM_FORGE_AUTH_MODE = "dev";
  process.env.STREAM_FORGE_START_IN_MEMORY_WORKERS = "false";
  delete process.env.STREAM_FORGE_INTERNAL_TOKEN;
  delete process.env.STREAM_FORGE_REDIS_URL;
  delete process.env.STREAM_FORGE_START_WORKERS;

  const app = await buildServer();
  t.after(async () => {
    await app.close();
  });

  const userHeaders = {
    "x-user-id": "e2e-failure-user"
  };

  const operatorHeaders = {
    "x-user-id": "e2e-operator",
    "x-role": "operator",
    "content-type": "application/json"
  };

  const bytes = Buffer.from("fake-video-content-failure-replay", "utf8");
  const filename = "failure-replay.mp4";

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
      sizeBytes: bytes.length,
      tenantId: "tenant-failure"
    })
  });

  assert.equal(createResponse.statusCode, 201, createResponse.body);
  const created = createResponse.json();

  const uploadPayload = buildMultipartUpload({
    fieldName: "file",
    filename,
    contentType: "video/mp4",
    content: bytes
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

  const forceFailureResponse = await app.inject({
    method: "POST",
    url: "/internal/workers/failure/run-once",
    headers: operatorHeaders,
    payload: JSON.stringify({
      videoId: created.videoId,
      stage: "metadata",
      errorMessage: "simulated failure"
    })
  });

  assert.equal(forceFailureResponse.statusCode, 200, forceFailureResponse.body);
  assert.equal(forceFailureResponse.json().status, "failed");

  const statusAfterFailure = await app.inject({
    method: "GET",
    url: `/videos/${created.videoId}/status`,
    headers: userHeaders
  });

  assert.equal(statusAfterFailure.statusCode, 200, statusAfterFailure.body);
  assert.equal(statusAfterFailure.json().status, "failed");

  const replayResponse = await app.inject({
    method: "POST",
    url: "/internal/dlq/replay",
    headers: operatorHeaders,
    payload: JSON.stringify({
      videoId: created.videoId,
      stage: "metadata"
    })
  });

  assert.equal(replayResponse.statusCode, 202, replayResponse.body);
  assert.equal(replayResponse.json().accepted, true);

  const metadataRun = await app.inject({
    method: "POST",
    url: "/internal/workers/metadata/run-once",
    headers: operatorHeaders,
    payload: JSON.stringify({ videoId: created.videoId })
  });
  assert.equal(metadataRun.statusCode, 200, metadataRun.body);

  const thumbnailRun = await app.inject({
    method: "POST",
    url: "/internal/workers/thumbnail/run-once",
    headers: operatorHeaders,
    payload: JSON.stringify({ videoId: created.videoId })
  });
  assert.equal(thumbnailRun.statusCode, 200, thumbnailRun.body);

  const transcodeRun = await app.inject({
    method: "POST",
    url: "/internal/workers/transcode/run-once",
    headers: operatorHeaders,
    payload: JSON.stringify({ videoId: created.videoId })
  });
  assert.equal(transcodeRun.statusCode, 200, transcodeRun.body);

  const notificationRun = await app.inject({
    method: "POST",
    url: "/internal/workers/notification/run-once",
    headers: operatorHeaders,
    payload: JSON.stringify({ videoId: created.videoId })
  });
  assert.equal(notificationRun.statusCode, 200, notificationRun.body);

  const readyStatus = await app.inject({
    method: "GET",
    url: `/videos/${created.videoId}/status`,
    headers: userHeaders
  });

  assert.equal(readyStatus.statusCode, 200, readyStatus.body);
  assert.equal(readyStatus.json().status, "ready");

  const replayWhileReady = await app.inject({
    method: "POST",
    url: "/internal/dlq/replay",
    headers: operatorHeaders,
    payload: JSON.stringify({
      videoId: created.videoId,
      stage: "transcode-orchestration"
    })
  });

  assert.equal(replayWhileReady.statusCode, 409, replayWhileReady.body);
});
