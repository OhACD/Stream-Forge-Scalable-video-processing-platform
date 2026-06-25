import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

import { SignJWT, exportJWK, generateKeyPair } from "jose";

import { buildServer } from "../dist/server.js";

const ENV_KEYS = [
  "NODE_ENV",
  "STREAM_FORGE_AUTH_MODE",
  "STREAM_FORGE_FIREBASE_PROJECT_ID",
  "STREAM_FORGE_FIREBASE_JWKS_URL",
  "STREAM_FORGE_FIREBASE_ISSUER",
  "STREAM_FORGE_FIREBASE_AUDIENCE",
  "STREAM_FORGE_INTERNAL_TOKEN",
  "STREAM_FORGE_START_IN_MEMORY_WORKERS",
  "STREAM_FORGE_START_WORKERS",
  "STREAM_FORGE_REDIS_URL"
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (typeof value === "undefined") {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}

async function createFirebaseHarness() {
  const projectId = "stream-forge-firebase-test";
  const issuer = `https://securetoken.google.com/${projectId}`;
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.use = "sig";
  jwk.alg = "RS256";
  jwk.kid = "stream-forge-test-key";

  const jwksServer = createServer((request, response) => {
    if (request.url !== "/jwks.json") {
      response.statusCode = 404;
      response.end();
      return;
    }

    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [jwk] }));
  });

  jwksServer.listen(0, "127.0.0.1");
  await once(jwksServer, "listening");

  const address = jwksServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve JWKS server address");
  }

  return {
    projectId,
    issuer,
    jwksUrl: `http://127.0.0.1:${address.port}/jwks.json`,
    async issueToken(claims = {}) {
      return new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "stream-forge-test-key" })
        .setIssuer(issuer)
        .setAudience(projectId)
        .setSubject(claims.sub ?? claims.user_id ?? "firebase-user")
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(privateKey);
    },
    async close() {
      await new Promise((resolve, reject) => {
        jwksServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

test("firebase auth rejects invalid bearer tokens with 401", async (t) => {
  const env = snapshotEnv();
  const harness = await createFirebaseHarness();

  process.env.STREAM_FORGE_AUTH_MODE = "firebase";
  process.env.STREAM_FORGE_FIREBASE_PROJECT_ID = harness.projectId;
  process.env.STREAM_FORGE_FIREBASE_JWKS_URL = harness.jwksUrl;
  process.env.STREAM_FORGE_FIREBASE_ISSUER = harness.issuer;
  process.env.STREAM_FORGE_FIREBASE_AUDIENCE = harness.projectId;
  process.env.STREAM_FORGE_START_IN_MEMORY_WORKERS = "false";
  delete process.env.STREAM_FORGE_INTERNAL_TOKEN;
  delete process.env.STREAM_FORGE_START_WORKERS;
  delete process.env.STREAM_FORGE_REDIS_URL;

  const app = await buildServer();
  t.after(async () => {
    await app.close();
    await harness.close();
    restoreEnv(env);
  });

  const response = await app.inject({
    method: "GET",
    url: "/videos",
    headers: {
      authorization: "Bearer not-a-valid-jwt"
    }
  });

  assert.equal(response.statusCode, 401, response.body);
});

test("firebase auth accepts valid JWTs and enforces operator role on internal routes", async (t) => {
  const env = snapshotEnv();
  const harness = await createFirebaseHarness();

  process.env.STREAM_FORGE_AUTH_MODE = "firebase";
  process.env.STREAM_FORGE_FIREBASE_PROJECT_ID = harness.projectId;
  process.env.STREAM_FORGE_FIREBASE_JWKS_URL = harness.jwksUrl;
  process.env.STREAM_FORGE_FIREBASE_ISSUER = harness.issuer;
  process.env.STREAM_FORGE_FIREBASE_AUDIENCE = harness.projectId;
  process.env.STREAM_FORGE_INTERNAL_TOKEN = "internal-test-token";
  process.env.STREAM_FORGE_START_IN_MEMORY_WORKERS = "false";
  delete process.env.STREAM_FORGE_START_WORKERS;
  delete process.env.STREAM_FORGE_REDIS_URL;

  const app = await buildServer();
  t.after(async () => {
    await app.close();
    await harness.close();
    restoreEnv(env);
  });

  const userToken = await harness.issueToken({
    user_id: "firebase-user",
    role: "viewer"
  });

  const listResponse = await app.inject({
    method: "GET",
    url: "/videos",
    headers: {
      authorization: `Bearer ${userToken}`
    }
  });

  assert.equal(listResponse.statusCode, 200, listResponse.body);

  const forbiddenInternalMetrics = await app.inject({
    method: "GET",
    url: "/internal/metrics",
    headers: {
      authorization: `Bearer ${userToken}`,
      "x-internal-token": "internal-test-token"
    }
  });

  assert.equal(forbiddenInternalMetrics.statusCode, 403, forbiddenInternalMetrics.body);

  const operatorToken = await harness.issueToken({
    user_id: "firebase-operator",
    role: "operator"
  });

  const internalMetricsResponse = await app.inject({
    method: "GET",
    url: "/internal/metrics",
    headers: {
      authorization: `Bearer ${operatorToken}`,
      "x-internal-token": "internal-test-token"
    }
  });

  assert.equal(internalMetricsResponse.statusCode, 200, internalMetricsResponse.body);
});

test("production mode requires internal token and protects metrics endpoint", async (t) => {
  const env = snapshotEnv();

  process.env.NODE_ENV = "production";
  process.env.STREAM_FORGE_AUTH_MODE = "dev";
  process.env.STREAM_FORGE_START_IN_MEMORY_WORKERS = "false";
  delete process.env.STREAM_FORGE_INTERNAL_TOKEN;
  delete process.env.STREAM_FORGE_START_WORKERS;
  delete process.env.STREAM_FORGE_REDIS_URL;

  await assert.rejects(() => buildServer(), /STREAM_FORGE_INTERNAL_TOKEN is required in production/);

  process.env.STREAM_FORGE_INTERNAL_TOKEN = "prod-internal-token";
  const app = await buildServer();
  t.after(async () => {
    await app.close();
    restoreEnv(env);
  });

  const unauthorizedMetricsResponse = await app.inject({
    method: "GET",
    url: "/metrics"
  });
  assert.equal(unauthorizedMetricsResponse.statusCode, 401, unauthorizedMetricsResponse.body);

  const authorizedMetricsResponse = await app.inject({
    method: "GET",
    url: "/metrics",
    headers: {
      "x-internal-token": "prod-internal-token"
    }
  });
  assert.equal(authorizedMetricsResponse.statusCode, 200, authorizedMetricsResponse.body);
  assert.match(authorizedMetricsResponse.body, /streamforge_http_requests_total/);
});