import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDatabaseClient, type DatabaseClient } from "@orchestrail/db";
import { apiKeys, tenants } from "@orchestrail/db";
import { eq } from "drizzle-orm";
import { createApplication } from "../src/app";
import {
  generateApiKey,
  hashApiKey,
} from "../src/features/api-keys/api-key.service";
import { API_SCOPES } from "../src/features/authentication/scopes";
import { provisionTenant } from "../src/features/tenants/tenant-provisioning.service";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://orchestrail_user:dev_postgres_password_123@localhost:5432/orchestrail_dev";

describe("Milestone 4: Tenant Management & API Key Authentication", () => {
  let dbClient: DatabaseClient;
  let app: ReturnType<typeof createApplication>;

  beforeAll(() => {
    dbClient = createDatabaseClient({ connectionString: databaseUrl });
    app = createApplication({ dbClient });
  });

  afterAll(async () => {
    await dbClient.close();
  });

  describe("Tenant Provisioning", () => {
    it("successfully provisions a tenant and generates initial privileged API key atomically", async () => {
      const slug = `prov-${Date.now()}`;
      const result = await provisionTenant(dbClient, {
        name: "Test Org",
        slug,
        eventRateLimitPerMinute: 2500,
        initialKeyName: "Root Admin Key",
      });

      expect(result.tenant.id).toBeString();
      expect(result.tenant.name).toBe("Test Org");
      expect(result.tenant.slug).toBe(slug);
      expect(result.tenant.status).toBe("active");
      expect(result.tenant.eventRateLimitPerMinute).toBe(2500);

      expect(result.apiKey.id).toBeString();
      expect(result.apiKey.name).toBe("Root Admin Key");
      expect(result.apiKey.plaintextKey).toStartWith("orch_live_");
      expect(result.apiKey.scopes).toContain("api_keys:write");
      expect(result.apiKey.scopes).toContain("events:write");

      // Verify that database stored the hash, NOT the plaintext key
      const [storedKey] = await dbClient.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, result.apiKey.id));

      expect(storedKey).toBeDefined();
      expect(storedKey?.keyHash).toBe(hashApiKey(result.apiKey.plaintextKey));
      expect(storedKey?.keyPrefix).toBe(result.apiKey.keyPrefix);

      // Clean up
      await dbClient.db.delete(tenants).where(eq(tenants.id, result.tenant.id));
    });

    it("rejects duplicate tenant slug and rolls back atomically", async () => {
      const slug = `dup-${Date.now()}`;
      const first = await provisionTenant(dbClient, {
        name: "First Org",
        slug,
      });

      let duplicateError = false;
      try {
        await provisionTenant(dbClient, {
          name: "Second Org",
          slug,
        });
      } catch (err: any) {
        duplicateError = true;
        expect(err.message).toContain("already taken");
      }

      expect(duplicateError).toBe(true);

      // Clean up
      await dbClient.db.delete(tenants).where(eq(tenants.id, first.tenant.id));
    });
  });

  describe("Authentication Middleware", () => {
    it("rejects request without Authorization header with 401", async () => {
      const res = await app.request("/v1/api-keys");
      expect(res.status).toBe(401);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toContain("Missing Authorization header");
    });

    it("rejects malformed token with 401", async () => {
      const res = await app.request("/v1/api-keys", {
        headers: { Authorization: "Bearer not_a_valid_token_format" },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toContain("Invalid API key format");
    });

    it("rejects invalid/non-existent API key with 401", async () => {
      const fakeKey = generateApiKey().plaintextKey;
      const res = await app.request("/v1/api-keys", {
        headers: { Authorization: `Bearer ${fakeKey}` },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toBe("Invalid API key");
    });

    it("rejects revoked API key with 401", async () => {
      const tenant = await provisionTenant(dbClient, {
        name: "Revoke Check Org",
        slug: `rev-org-${Date.now()}`,
      });

      // Manually mark key as revoked
      await dbClient.db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(eq(apiKeys.id, tenant.apiKey.id));

      const res = await app.request("/v1/api-keys", {
        headers: { Authorization: `Bearer ${tenant.apiKey.plaintextKey}` },
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toBe("API key has been revoked");

      await dbClient.db.delete(tenants).where(eq(tenants.id, tenant.tenant.id));
    });

    it("rejects expired API key with 401", async () => {
      const tenant = await provisionTenant(dbClient, {
        name: "Expire Check Org",
        slug: `exp-org-${Date.now()}`,
      });

      // Manually set past expiration
      await dbClient.db
        .update(apiKeys)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(apiKeys.id, tenant.apiKey.id));

      const res = await app.request("/v1/api-keys", {
        headers: { Authorization: `Bearer ${tenant.apiKey.plaintextKey}` },
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toBe("API key has expired");

      await dbClient.db.delete(tenants).where(eq(tenants.id, tenant.tenant.id));
    });

    it("rejects API key belonging to suspended tenant with 403", async () => {
      const tenant = await provisionTenant(dbClient, {
        name: "Suspended Org",
        slug: `susp-org-${Date.now()}`,
      });

      // Suspend tenant
      await dbClient.db
        .update(tenants)
        .set({ status: "suspended" })
        .where(eq(tenants.id, tenant.tenant.id));

      const res = await app.request("/v1/api-keys", {
        headers: { Authorization: `Bearer ${tenant.apiKey.plaintextKey}` },
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toContain("Tenant organization is suspended");

      await dbClient.db.delete(tenants).where(eq(tenants.id, tenant.tenant.id));
    });
  });

  describe("API Keys CRUD Endpoints & Scope Enforcement", () => {
    it("creates a new API key and returns plaintext secret exactly once", async () => {
      const adminTenant = await provisionTenant(dbClient, {
        name: "Admin Tenant",
        slug: `adm-${Date.now()}`,
      });

      const createRes = await app.request("/v1/api-keys", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminTenant.apiKey.plaintextKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Ingestion Key",
          scopes: [API_SCOPES.EVENTS_WRITE],
        }),
      });

      expect(createRes.status).toBe(201);
      const createBody = (await createRes.json()) as any;
      expect(createBody.data.id).toBeString();
      expect(createBody.data.name).toBe("Ingestion Key");
      expect(createBody.data.key_prefix).toStartWith("orch_live_");
      expect(createBody.data.api_key).toStartWith("orch_live_");
      expect(createBody.data.scopes).toEqual([API_SCOPES.EVENTS_WRITE]);

      // List keys: Plaintext secret and hash must NOT be present
      const listRes = await app.request("/v1/api-keys", {
        headers: {
          Authorization: `Bearer ${adminTenant.apiKey.plaintextKey}`,
        },
      });

      expect(listRes.status).toBe(200);
      const listBody = (await listRes.json()) as any;
      expect(listBody.data.length).toBeGreaterThanOrEqual(2);
      expect(listBody.data[0].api_key).toBeUndefined();
      expect(listBody.data[0].key_hash).toBeUndefined();

      // Revoke the newly created key
      const deleteRes = await app.request(
        `/v1/api-keys/${createBody.data.id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${adminTenant.apiKey.plaintextKey}`,
          },
        },
      );

      expect(deleteRes.status).toBe(200);
      const deleteBody = (await deleteRes.json()) as any;
      expect(deleteBody.data.status).toBe("revoked");

      // Verify the revoked key can no longer authenticate
      const useRevokedRes = await app.request("/v1/api-keys", {
        headers: {
          Authorization: `Bearer ${createBody.data.api_key}`,
        },
      });
      expect(useRevokedRes.status).toBe(401);

      await dbClient.db
        .delete(tenants)
        .where(eq(tenants.id, adminTenant.tenant.id));
    });

    it("prevents scope escalation when creating keys", async () => {
      const adminTenant = await provisionTenant(dbClient, {
        name: "Escalation Test Org",
        slug: `esc-${Date.now()}`,
      });

      // Create a restricted key with only events:write (no api_keys:write)
      const restrictedRes = await app.request("/v1/api-keys", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminTenant.apiKey.plaintextKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Restricted Ingestion Key",
          scopes: [API_SCOPES.EVENTS_WRITE],
        }),
      });
      const restrictedKey = (await restrictedRes.json()) as any;

      // Restricted key attempts to call POST /v1/api-keys (lacks api_keys:write)
      const attemptRes = await app.request("/v1/api-keys", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${restrictedKey.data.api_key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Escalated Key",
          scopes: [API_SCOPES.API_KEYS_WRITE],
        }),
      });

      expect(attemptRes.status).toBe(403);
      const attemptBody = (await attemptRes.json()) as any;
      expect(attemptBody.error.code).toBe("FORBIDDEN");

      await dbClient.db
        .delete(tenants)
        .where(eq(tenants.id, adminTenant.tenant.id));
    });
  });

  describe("Tenant Isolation", () => {
    it("Tenant A cannot list or revoke Tenant B's keys", async () => {
      const tenantA = await provisionTenant(dbClient, {
        name: "Tenant Alpha",
        slug: `alpha-${Date.now()}`,
      });

      const tenantB = await provisionTenant(dbClient, {
        name: "Tenant Beta",
        slug: `beta-${Date.now()}`,
      });

      // Tenant A lists keys: should NOT see Tenant B's key
      const listResA = await app.request("/v1/api-keys", {
        headers: {
          Authorization: `Bearer ${tenantA.apiKey.plaintextKey}`,
        },
      });
      const listA = (await listResA.json()) as any;
      const foundBKey = listA.data.find((k: any) => k.id === tenantB.apiKey.id);
      expect(foundBKey).toBeUndefined();

      // Tenant A attempts to delete Tenant B's key: returns 404 NOT_FOUND (never leaks existence)
      const deleteResA = await app.request(
        `/v1/api-keys/${tenantB.apiKey.id}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${tenantA.apiKey.plaintextKey}`,
          },
        },
      );

      expect(deleteResA.status).toBe(404);
      const deleteBody = (await deleteResA.json()) as any;
      expect(deleteBody.error.code).toBe("NOT_FOUND");

      // Verify Tenant B's key was NOT revoked
      const [bKeyInDb] = await dbClient.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, tenantB.apiKey.id));
      expect(bKeyInDb?.revokedAt).toBeNull();

      // Clean up
      await dbClient.db
        .delete(tenants)
        .where(eq(tenants.id, tenantA.tenant.id));
      await dbClient.db
        .delete(tenants)
        .where(eq(tenants.id, tenantB.tenant.id));
    });
  });
});
