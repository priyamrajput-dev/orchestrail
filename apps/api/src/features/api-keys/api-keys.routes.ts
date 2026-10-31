import type { DatabaseClient } from "@orchestrail/db";
import { apiKeys, tenants } from "@orchestrail/db";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables } from "../../app";
import { AppError } from "../../common/errors/app-error";
import { ERROR_CODES } from "../../common/errors/error-codes";
import { requireScope } from "../authentication/require-scope.middleware";
import { ALL_SCOPES, API_SCOPES } from "../authentication/scopes";
import { generateApiKey } from "./api-key.service";

const createKeySchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name exceeds 100 characters"),
  scopes: z
    .array(z.string())
    .min(1, "At least one scope is required")
    .refine(
      (scopes) => scopes.every((s) => ALL_SCOPES.includes(s as any)),
      "Contains invalid scopes",
    ),
  expires_at: z.string().datetime().nullable().optional(),
});

export function createApiKeysRouter(dbClient: DatabaseClient) {
  const router = new Hono<{ Variables: AppVariables }>();

  // 1. POST /v1/api-keys — Create new API Key
  router.post("/", requireScope(API_SCOPES.API_KEYS_WRITE), async (c) => {
    const tenantId = c.get("tenantId") as string;
    const callerScopes = c.get("scopes") || [];

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Invalid JSON request body",
      });
    }

    const parseResult = createKeySchema.safeParse(body);
    if (!parseResult.success) {
      throw parseResult.error;
    }

    const { name, scopes, expires_at } = parseResult.data;

    // Prevent scope escalation: Key cannot grant scopes it does not possess
    const ungrantedScopes = scopes.filter((s) => !callerScopes.includes(s));
    if (ungrantedScopes.length > 0) {
      throw new AppError({
        code: ERROR_CODES.FORBIDDEN,
        message: `Scope escalation prevented: cannot grant scopes you do not possess (${ungrantedScopes.join(", ")})`,
      });
    }

    const generated = generateApiKey();
    const expiresAt = expires_at ? new Date(expires_at) : null;

    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "expires_at must be in the future",
      });
    }

    const [newKey] = await dbClient.db
      .insert(apiKeys)
      .values({
        tenantId,
        name,
        keyPrefix: generated.keyPrefix,
        keyHash: generated.keyHash,
        scopes,
        expiresAt,
      })
      .returning();

    if (!newKey) {
      throw new AppError({
        code: ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: "Failed to persist API key",
      });
    }

    // Return plaintext key exactly once
    return c.json(
      {
        data: {
          id: newKey.id,
          name: newKey.name,
          key_prefix: newKey.keyPrefix,
          scopes: newKey.scopes,
          api_key: generated.plaintextKey, // ONLY REVEALED HERE
          expires_at: newKey.expiresAt?.toISOString() ?? null,
          created_at: newKey.createdAt.toISOString(),
        },
      },
      201,
    );
  });

  // 2. GET /v1/api-keys — List tenant API keys (cursor pagination)
  router.get("/", requireScope(API_SCOPES.API_KEYS_READ), async (c) => {
    const tenantId = c.get("tenantId") as string;

    const limitParam = c.req.query("limit");
    const cursor = c.req.query("cursor");

    const limit = Math.min(Math.max(Number(limitParam) || 20, 1), 100);

    const conditions = [
      eq(apiKeys.tenantId, tenantId),
      isNull(apiKeys.revokedAt), // Only active/non-revoked keys by default
    ];

    if (cursor) {
      const cursorDate = new Date(cursor);
      if (!isNaN(cursorDate.getTime())) {
        conditions.push(gt(apiKeys.createdAt, cursorDate));
      }
    }

    const records = await dbClient.db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        expiresAt: apiKeys.expiresAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(and(...conditions))
      .orderBy(desc(apiKeys.createdAt))
      .limit(limit + 1);

    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;
    const nextCursor =
      hasMore && items.length > 0
        ? items[items.length - 1]!.createdAt.toISOString()
        : null;

    return c.json({
      data: items.map((k) => ({
        id: k.id,
        name: k.name,
        key_prefix: k.keyPrefix,
        scopes: k.scopes,
        last_used_at: k.lastUsedAt?.toISOString() ?? null,
        expires_at: k.expiresAt?.toISOString() ?? null,
        created_at: k.createdAt.toISOString(),
      })),
      pagination: {
        has_more: hasMore,
        next_cursor: nextCursor,
      },
    });
  });

  // 3. DELETE /v1/api-keys/:keyId — Revoke an API key
  router.delete(
    "/:keyId",
    requireScope(API_SCOPES.API_KEYS_WRITE),
    async (c) => {
      const tenantId = c.get("tenantId") as string;
      const keyId = c.req.param("keyId");

      // Must belong to the caller's tenant
      const [existingKey] = await dbClient.db
        .select({
          id: apiKeys.id,
          revokedAt: apiKeys.revokedAt,
        })
        .from(apiKeys)
        .where(and(eq(apiKeys.id, keyId), eq(apiKeys.tenantId, tenantId)));

      if (!existingKey) {
        throw new AppError({
          code: ERROR_CODES.NOT_FOUND,
          message: "API key not found",
        });
      }

      if (existingKey.revokedAt) {
        return c.json({
          data: {
            id: existingKey.id,
            status: "already_revoked",
            revoked_at: existingKey.revokedAt.toISOString(),
          },
        });
      }

      const now = new Date();
      const [revokedKey] = await dbClient.db
        .update(apiKeys)
        .set({ revokedAt: now })
        .where(and(eq(apiKeys.id, keyId), eq(apiKeys.tenantId, tenantId)))
        .returning();

      return c.json({
        data: {
          id: revokedKey!.id,
          status: "revoked",
          revoked_at: now.toISOString(),
        },
      });
    },
  );

  return router;
}
