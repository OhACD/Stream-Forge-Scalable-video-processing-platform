import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

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

async function createUploadedVideo(app, userId, tenantId, filename) {
  const userHeaders = { "x-user-id": userId };
  const uploadBytes = Buffer.from(`video-${filename}`, "utf8");

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
      tenantId
    })
  });
  assert.equal(createResponse.statusCode, 201, createResponse.body);

  const uploadPayload = buildMultipartUpload({
    fieldName: "file",
    filename,
    contentType: "video/mp4",
    content: uploadBytes
  });

  const videoId = createResponse.json().videoId;
  const uploadResponse = await app.inject({
    method: "POST",
    url: `/videos/${videoId}/upload`,
    headers: {
      ...userHeaders,
      "content-type": uploadPayload.contentType
    },
    payload: uploadPayload.body
  });
  assert.equal(uploadResponse.statusCode, 202, uploadResponse.body);

  return { videoId, userHeaders };
}

test("observability exposes pipeline SLIs for success and failure paths", async (t) => {
  process.env.STREAM_FORGE_AUTH_MODE = "dev";
  process.env.STREAM_FORGE_START_IN_MEMORY_WORKERS = "false";
  delete process.env.STREAM_FORGE_INTERNAL_TOKEN;
  delete process.env.STREAM_FORGE_REDIS_URL;
  delete process.env.STREAM_FORGE_START_WORKERS;

  const app = await buildServer();
  t.after(async () => {
    await app.close();
  });

  const operatorHeaders = {
    "x-user-id": "observability-operator",
    "x-role": "operator",
    "content-type": "application/json"
  };

  const readyVideo = await createUploadedVideo(app, "ready-user", "tenant-ready", "ready.mp4");
  for (const route of ["metadata", "thumbnail", "transcode", "notification"]) {
    const response = await app.inject({
      method: "POST",
      url: `/internal/workers/${route}/run-once`,
      headers: operatorHeaders,
      payload: JSON.stringify({ videoId: readyVideo.videoId })
    });
    assert.equal(response.statusCode, 200, response.body);
  }

  const failedVideo = await createUploadedVideo(app, "failed-user", "tenant-failed", "failed.mp4");
  const failureResponse = await app.inject({
    method: "POST",
    url: "/internal/workers/failure/run-once",
    headers: operatorHeaders,
    payload: JSON.stringify({
      videoId: failedVideo.videoId,
      stage: "metadata",
      errorMessage: "simulated observability failure"
    })
  });
  assert.equal(failureResponse.statusCode, 200, failureResponse.body);

  const internalMetricsResponse = await app.inject({
    method: "GET",
    url: "/internal/metrics",
    headers: operatorHeaders
  });
  assert.equal(internalMetricsResponse.statusCode, 200, internalMetricsResponse.body);

  const internalMetrics = internalMetricsResponse.json();
  assert.equal(internalMetrics.pipeline.successTotal, 1);
  assert.equal(internalMetrics.pipeline.failureTotal, 1);
  assert.equal(internalMetrics.pipeline.stageFailures.metadata, 1);
  assert.equal(internalMetrics.pipeline.uploadToFirstStageStart.count, 1);
  assert.equal(internalMetrics.pipeline.endToEnd.count, 1);

  const prometheusMetricsResponse = await app.inject({
    method: "GET",
    url: "/metrics"
  });
  assert.equal(prometheusMetricsResponse.statusCode, 200, prometheusMetricsResponse.body);
  assert.match(prometheusMetricsResponse.body, /streamforge_pipeline_success_total 1/);
  assert.match(prometheusMetricsResponse.body, /streamforge_pipeline_failure_total 1/);
  assert.match(prometheusMetricsResponse.body, /streamforge_pipeline_stage_failure_total\{stage="metadata"\} 1/);
  assert.match(prometheusMetricsResponse.body, /streamforge_pipeline_upload_to_first_stage_start_ms_count 1/);
  assert.match(prometheusMetricsResponse.body, /streamforge_pipeline_end_to_end_ms_count 1/);
});