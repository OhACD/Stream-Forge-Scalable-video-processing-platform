import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose";

export type AuthMode = "dev" | "firebase" | "hybrid";

export type AuthPrincipal = {
  userId: string;
  tenantId?: string;
  role?: string;
  authMode: "firebase-jwt" | "dev-header";
};

export interface Authenticator {
  authenticate(headers: Record<string, unknown>): Promise<AuthPrincipal | null>;
}

export type AuthRuntime = {
  authenticator: Authenticator;
  mode: AuthMode;
};

class DevHeaderAuthenticator implements Authenticator {
  async authenticate(headers: Record<string, unknown>): Promise<AuthPrincipal | null> {
    const userId = headers["x-user-id"];
    if (typeof userId !== "string" || userId.length === 0) {
      return null;
    }

    const tenantId = typeof headers["x-tenant-id"] === "string" ? headers["x-tenant-id"] : undefined;
    const role = typeof headers["x-role"] === "string" ? headers["x-role"] : undefined;

    return {
      userId,
      ...(tenantId ? { tenantId } : {}),
      ...(role ? { role } : {}),
      authMode: "dev-header"
    };
  }
}

class FirebaseJwtAuthenticator implements Authenticator {
  private readonly jwks;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(private readonly projectId: string) {
    const jwksUrl = process.env.STREAM_FORGE_FIREBASE_JWKS_URL
      ?? "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
    this.jwks = createRemoteJWKSet(
      new URL(jwksUrl)
    );
    this.issuer = process.env.STREAM_FORGE_FIREBASE_ISSUER ?? `https://securetoken.google.com/${projectId}`;
    this.audience = process.env.STREAM_FORGE_FIREBASE_AUDIENCE ?? projectId;
  }

  async authenticate(headers: Record<string, unknown>): Promise<AuthPrincipal | null> {
    const authorization = headers.authorization;
    if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
      return null;
    }

    const token = authorization.slice("Bearer ".length);
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience
      });

      return payloadToPrincipal(payload);
    } catch {
      return null;
    }
  }
}

class CompositeAuthenticator implements Authenticator {
  constructor(private readonly authenticators: Authenticator[]) {}

  async authenticate(headers: Record<string, unknown>): Promise<AuthPrincipal | null> {
    for (const authenticator of this.authenticators) {
      const principal = await authenticator.authenticate(headers);
      if (principal) {
        return principal;
      }
    }

    return null;
  }
}

function payloadToPrincipal(payload: JWTPayload): AuthPrincipal {
  const userId = typeof payload.user_id === "string"
    ? payload.user_id
    : typeof payload.sub === "string"
      ? payload.sub
      : null;

  if (!userId) {
    throw new Error("INVALID_AUTH_TOKEN");
  }

  const firebaseClaim = typeof payload.firebase === "object" && payload.firebase !== null
    ? payload.firebase as Record<string, unknown>
    : undefined;

  const tenantId = typeof payload.tenant_id === "string"
    ? payload.tenant_id
    : typeof firebaseClaim?.tenant === "string"
      ? firebaseClaim.tenant
      : undefined;

  const role = typeof payload.role === "string" ? payload.role : undefined;

  return {
    userId,
    ...(tenantId ? { tenantId } : {}),
    ...(role ? { role } : {}),
    authMode: "firebase-jwt"
  };
}

export function createAuthenticator(): Authenticator {
  const firebaseProjectId = process.env.STREAM_FORGE_FIREBASE_PROJECT_ID;
  const authMode = resolveAuthMode();

  switch (authMode) {
    case "dev":
      return new DevHeaderAuthenticator();
    case "firebase":
      if (!firebaseProjectId) {
        throw new Error("STREAM_FORGE_FIREBASE_PROJECT_ID is required when Firebase auth is enabled");
      }

      return new FirebaseJwtAuthenticator(firebaseProjectId);
    case "hybrid":
      if (!firebaseProjectId) {
        throw new Error("STREAM_FORGE_FIREBASE_PROJECT_ID is required when hybrid auth is enabled");
      }

      return new CompositeAuthenticator([
        new FirebaseJwtAuthenticator(firebaseProjectId),
        new DevHeaderAuthenticator()
      ]);
  }

  throw new Error(`Unsupported auth mode: ${authMode satisfies never}`);
}

export function createAuthRuntime(): AuthRuntime {
  const mode = resolveAuthMode();

  return {
    authenticator: createAuthenticator(),
    mode
  };
}

function resolveAuthMode(): AuthMode {
  const configuredMode = process.env.STREAM_FORGE_AUTH_MODE;
  if (configuredMode === "dev" || configuredMode === "firebase" || configuredMode === "hybrid") {
    return configuredMode;
  }

  if (configuredMode) {
    throw new Error("STREAM_FORGE_AUTH_MODE must be one of dev, firebase, or hybrid");
  }

  if (process.env.STREAM_FORGE_ALLOW_DEV_AUTH === "false") {
    return "firebase";
  }

  return process.env.NODE_ENV === "production" ? "firebase" : "dev";
}
