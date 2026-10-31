import type { DatabaseClient } from "@orchestrail/db";
import { apiKeys, tenants } from "@orchestrail/db";
import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { AppError } from "../../common/errors/app-error";
import { ERROR_CODES } from "../../common/errors/error-codes";
import {
  extractKeyPrefix,
  verifyApiKeyHash,
} from "../api-keys/api-key.service";

// In-memory cache to throttle last_used_at database updates (e.g. once every 60 seconds per key)
const lastUsedUpdateTimestamps = new Map<string, number>();
const LAST_USED_THROTTLE_MS = 60_000;

export function apiKeyAuthMiddleware(
  dbClient: DatabaseClient,
): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header("authorization");

    if (!authHeader) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: "Missing Authorization header",
      });
    }

    const parts = authHeader.trim().split(" ");
    if (
      parts.length !== 2 ||
      parts[0]?.toLowerCase() !== "bearer" ||
      !parts[1]
    ) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message:
          "Invalid Authorization header format. Expected 'Bearer <api_key>'",
      });
    }

    const rawToken = parts[1];
    const keyPrefix = extractKeyPrefix(rawToken);

    if (!keyPrefix) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: "Invalid API key format",
      });
    }

    // Lookup record by the indexed public keyPrefix
    const [apiKeyRecord] = await dbClient.db
      .select({
        id: apiKeys.id,
        tenantId: apiKeys.tenantId,
        keyHash: apiKeys.keyHash,
        scopes: apiKeys.scopes,
        expiresAt: apiKeys.expiresAt,
        revokedAt: apiKeys.revokedAt,
        tenantStatus: tenants.status,
      })
      .from(apiKeys)
      .innerJoin(tenants, eq(apiKeys.tenantId, tenants.id))
      .where(eq(apiKeys.keyPrefix, keyPrefix));

    if (!apiKeyRecord) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: "Invalid API key",
      });
    }

    // Timing-safe comparison of computed hash and stored hash
    const isValid = verifyApiKeyHash(rawToken, apiKeyRecord.keyHash);
    if (!isValid) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: "Invalid API key",
      });
    }

    // Check revocation
    if (apiKeyRecord.revokedAt) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: "API key has been revoked",
      });
    }

    // Check expiration
    if (
      apiKeyRecord.expiresAt &&
      apiKeyRecord.expiresAt.getTime() <= Date.now()
    ) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: "API key has expired",
      });
    }

    // Check tenant status
    if (apiKeyRecord.tenantStatus !== "active") {
      throw new AppError({
        code: ERROR_CODES.FORBIDDEN,
        message: "Tenant organization is suspended",
      });
    }

    // Establish authenticated context
    c.set("tenantId", apiKeyRecord.tenantId);
    c.set("apiKeyId", apiKeyRecord.id);
    c.set("scopes", apiKeyRecord.scopes);

    // Throttled update of lastUsedAt (fire-and-forget, non-blocking)
    const now = Date.now();
    const lastUpdate = lastUsedUpdateTimestamps.get(apiKeyRecord.id) ?? 0;
    if (now - lastUpdate > LAST_USED_THROTTLE_MS) {
      lastUsedUpdateTimestamps.set(apiKeyRecord.id, now);
      dbClient.db
        .update(apiKeys)
        .set({ lastUsedAt: new Date(now) })
        .where(eq(apiKeys.id, apiKeyRecord.id))
        .catch((err) => {
          console.error(
            "Failed to update last_used_at for key:",
            apiKeyRecord.id,
            err.message,
          );
        });
    }

    await next();
  };
}
