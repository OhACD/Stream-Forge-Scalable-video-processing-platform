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

test("v1 lifecycle acceptance: create, upload, process, query, retry guard, delete", async (t) => {
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
    "x-user-id": "e2e-user"
  };

  const tenantId = "tenant-e2e";
  const uploadBytes = Buffer.from("fake-video-content-acceptance", "utf8");
  const filename = "acceptance.mp4";

  const createResponse = await app.inject({
    method: "POST",
    url: "/videos",
    headers: {
      ...userHeaders,
      "content-type": "application/json",
      "idempotency-key": `create-${Date.now()}`
    },
    payload: JSON.stringify({
      filename,
      contentType: "video/mp4",
      sizeBytes: uploadBytes.length,
      tenantId
    })
  });

  assert.equal(createResponse.statusCode, 201, createResponse.body);
  const created = createResponse.json();
  assert.ok(created.videoId);

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
  const uploaded = uploadResponse.json();
  assert.equal(uploaded.videoId, created.videoId);
  assert.equal(uploaded.status, "processing");
  assert.equal(uploaded.activeStage, "metadata");

  const statusAfterUpload = await app.inject({
    method: "GET",
    url: `/videos/${created.videoId}/status`,
    headers: userHeaders
  });

  assert.equal(statusAfterUpload.statusCode, 200, statusAfterUpload.body);
  assert.equal(statusAfterUpload.json().status, "processing");

  const operatorHeaders = {
    "x-user-id": "e2e-operator",
    "x-role": "operator",
    "content-type": "application/json"
  };

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

  const detailsResponse = await app.inject({
    method: "GET",
    url: `/videos/${created.videoId}`,
    headers: userHeaders
  });

  assert.equal(detailsResponse.statusCode, 200, detailsResponse.body);
  const details = detailsResponse.json();
  assert.equal(details.status, "ready");
  assert.ok(Array.isArray(details.assets.thumbnailUrls));
  assert.ok(details.assets.thumbnailUrls.length > 0);
  assert.ok(Array.isArray(details.assets.variantUrls));
  assert.ok(details.assets.variantUrls.length > 0);

  const listResponse = await app.inject({
    method: "GET",
    url: "/videos",
    headers: userHeaders
  });

  assert.equal(listResponse.statusCode, 200, listResponse.body);
  const listed = listResponse.json();
  assert.ok(listed.items.some((item) => item.videoId === created.videoId));

  const retryResponse = await app.inject({
    method: "POST",
    url: `/videos/${created.videoId}/retry`,
    headers: {
      ...userHeaders,
      "content-type": "application/json"
    },
    payload: JSON.stringify({ stage: "transcode-orchestration" })
  });

  assert.equal(retryResponse.statusCode, 409, retryResponse.body);

  const deleteIdempotencyKey = `delete-${Date.now()}`;
  const deleteResponse = await app.inject({
    method: "DELETE",
    url: `/videos/${created.videoId}`,
    headers: {
      ...userHeaders,
      "idempotency-key": deleteIdempotencyKey
    }
  });

  assert.equal(deleteResponse.statusCode, 200, deleteResponse.body);
  assert.equal(deleteResponse.json().status, "deleted");

  const replayDeleteResponse = await app.inject({
    method: "DELETE",
    url: `/videos/${created.videoId}`,
    headers: {
      ...userHeaders,
      "idempotency-key": deleteIdempotencyKey
    }
  });

  assert.equal(replayDeleteResponse.statusCode, 200, replayDeleteResponse.body);
  assert.deepEqual(replayDeleteResponse.json(), deleteResponse.json());

  const unauthenticatedListResponse = await app.inject({
    method: "GET",
    url: "/videos"
  });

  assert.equal(unauthenticatedListResponse.statusCode, 401, unauthenticatedListResponse.body);
});
