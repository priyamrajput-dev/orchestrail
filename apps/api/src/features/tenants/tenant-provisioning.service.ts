import type { DatabaseClient } from "@orchestrail/db";
import { apiKeys, tenants } from "@orchestrail/db";
import { AppError } from "../../common/errors/app-error";
import { ERROR_CODES } from "../../common/errors/error-codes";
import { generateApiKey } from "../api-keys/api-key.service";
import { ALL_SCOPES } from "../authentication/scopes";

export interface ProvisionTenantInput {
  name: string;
  slug: string;
  eventRateLimitPerMinute?: number;
  initialKeyName?: string;
}

export interface ProvisionTenantResult {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    eventRateLimitPerMinute: number;
    createdAt: Date;
  };
  apiKey: {
    id: string;
    name: string;
    keyPrefix: string;
    scopes: string[];
    plaintextKey: string;
  };
}

/**
 * Atomically provisions a new tenant and generates their initial administrative API key.
 * This is a controlled internal operation (CLI or admin script), not a public HTTP route.
 */
export async function provisionTenant(
  dbClient: DatabaseClient,
  input: ProvisionTenantInput,
): Promise<ProvisionTenantResult> {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();

  if (!name || name.length > 255) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Tenant name must be between 1 and 255 characters",
    });
  }

  // Validate slug format: alphanumeric and hyphens only
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message:
        "Tenant slug must be lowercase alphanumeric with hyphens (e.g. acme-corp)",
    });
  }

  const rateLimit = input.eventRateLimitPerMinute ?? 1000;
  if (rateLimit <= 0) {
    throw new AppError({
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "eventRateLimitPerMinute must be positive",
    });
  }

  const generatedKey = generateApiKey();
  const keyName = input.initialKeyName?.trim() || "Default Admin Key";

  try {
    // Atomic transaction using Bun.SQL and Drizzle ORM
    return await dbClient.db.transaction(async (tx) => {
      // 1. Insert Tenant
      const [tenant] = await tx
        .insert(tenants)
        .values({
          name,
          slug,
          status: "active",
          eventRateLimitPerMinute: rateLimit,
        })
        .returning();

      if (!tenant) {
        throw new AppError({
          code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          message: "Failed to create tenant",
        });
      }

      // 2. Insert Initial Administrative API Key
      const [apiKey] = await tx
        .insert(apiKeys)
        .values({
          tenantId: tenant.id,
          name: keyName,
          keyPrefix: generatedKey.keyPrefix,
          keyHash: generatedKey.keyHash,
          scopes: [...ALL_SCOPES], // Full administrative scopes
        })
        .returning();

      if (!apiKey) {
        throw new AppError({
          code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          message: "Failed to create initial API key",
        });
      }

      return {
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          status: tenant.status,
          eventRateLimitPerMinute: tenant.eventRateLimitPerMinute,
          createdAt: tenant.createdAt,
        },
        apiKey: {
          id: apiKey.id,
          name: apiKey.name,
          keyPrefix: apiKey.keyPrefix,
          scopes: apiKey.scopes,
          plaintextKey: generatedKey.plaintextKey,
        },
      };
    });
  } catch (err: any) {
    // Handle duplicate slug safely
    const causeMsg = String(err.cause?.message || err.message);
    const errno = String(err.cause?.errno);

    if (causeMsg.includes("tenants_slug_key") || errno === "23505") {
      throw new AppError({
        code: ERROR_CODES.CONFLICT,
        message: `Tenant slug '${slug}' is already taken`,
      });
    }

    throw err;
  }
}
