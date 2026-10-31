import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { createDatabaseClient } from "../src/client";
import { tenants } from "../src/schema/tenants";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://orchestrail_user:dev_postgres_password_123@localhost:5432/orchestrail_dev";

describe("@orchestrail/db with Bun.SQL + Drizzle ORM", () => {
  it("connects to PostgreSQL via Bun.SQL, executes SELECT 1, and reports healthy", async () => {
    const client = createDatabaseClient({ connectionString: databaseUrl });
    try {
      const isHealthy = await client.healthCheck();
      expect(isHealthy).toBe(true);

      const raw = await client.sql`SELECT 1 AS num`;
      expect(raw[0].num).toBe(1);
    } finally {
      await client.close();
    }
  });

  it("inserts and selects a tenant with generated UUID and default status", async () => {
    const client = createDatabaseClient({ connectionString: databaseUrl });
    const testSlug = `test-tenant-${Date.now()}`;

    try {
      const [inserted] = await client.db
        .insert(tenants)
        .values({
          name: "Acme Corporation",
          slug: testSlug,
          eventRateLimitPerMinute: 1000,
        })
        .returning();

      expect(inserted).toBeDefined();
      expect(inserted?.id).toBeString();
      expect(inserted?.name).toBe("Acme Corporation");
      expect(inserted?.slug).toBe(testSlug);
      expect(inserted?.status).toBe("active");
      expect(inserted?.eventRateLimitPerMinute).toBe(1000);
      expect(inserted?.createdAt).toBeInstanceOf(Date);
      expect(inserted?.updatedAt).toBeInstanceOf(Date);

      // Verify select
      const [found] = await client.db
        .select()
        .from(tenants)
        .where(eq(tenants.slug, testSlug));
      expect(found).toBeDefined();
      expect(found?.id).toBe(inserted?.id);

      // Clean up
      await client.db.delete(tenants).where(eq(tenants.slug, testSlug));
    } finally {
      await client.close();
    }
  });

  it("enforces unique slug constraint", async () => {
    const client = createDatabaseClient({ connectionString: databaseUrl });
    const duplicateSlug = `dup-slug-${Date.now()}`;

    try {
      await client.db.insert(tenants).values({
        name: "First Company",
        slug: duplicateSlug,
        eventRateLimitPerMinute: 500,
      });

      let errorThrown = false;
      try {
        await client.db.insert(tenants).values({
          name: "Second Company",
          slug: duplicateSlug,
          eventRateLimitPerMinute: 500,
        });
      } catch (err: any) {
        errorThrown = true;
        const causeMsg = String(err.cause?.message || err.message);
        const errno = String(err.cause?.errno);
        expect(causeMsg.includes("tenants_slug_key") || errno === "23505").toBe(
          true,
        );
      }

      expect(errorThrown).toBe(true);
      await client.db.delete(tenants).where(eq(tenants.slug, duplicateSlug));
    } finally {
      await client.close();
    }
  });

  it("rejects non-positive event_rate_limit_per_minute via CHECK constraint", async () => {
    const client = createDatabaseClient({ connectionString: databaseUrl });
    const invalidSlug = `invalid-rate-${Date.now()}`;

    try {
      let errorThrown = false;
      try {
        await client.db.insert(tenants).values({
          name: "Bad Rate Company",
          slug: invalidSlug,
          eventRateLimitPerMinute: 0, // Violates CHECK > 0
        });
      } catch (err: any) {
        errorThrown = true;
        const causeMsg = String(err.cause?.message || err.message);
        const errno = String(err.cause?.errno);
        expect(
          causeMsg.includes("event_rate_limit_per_minute_positive") ||
            errno === "23514",
        ).toBe(true);
      }

      expect(errorThrown).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("rejects null values for required columns", async () => {
    const client = createDatabaseClient({ connectionString: databaseUrl });

    try {
      let errorThrown = false;
      try {
        await client.db.insert(tenants).values({
          name: null as unknown as string,
          slug: `null-test-${Date.now()}`,
          eventRateLimitPerMinute: 100,
        });
      } catch (err: any) {
        errorThrown = true;
        const causeMsg = String(err.cause?.message || err.message);
        const errno = String(err.cause?.errno);
        expect(
          causeMsg.includes("null value in column") || errno === "23502",
        ).toBe(true);
      }

      expect(errorThrown).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("supports atomic transactions with rollback on failure", async () => {
    const client = createDatabaseClient({ connectionString: databaseUrl });
    const txSlugSuccess = `tx-slug-ok-${Date.now()}`;
    const txSlugFail = `tx-slug-fail-${Date.now()}`;

    try {
      // 1. Transaction that succeeds
      await client.db.transaction(async (tx) => {
        await tx.insert(tenants).values({
          name: "Tx Success Tenant",
          slug: txSlugSuccess,
          eventRateLimitPerMinute: 200,
        });
      });

      const [foundSuccess] = await client.db
        .select()
        .from(tenants)
        .where(eq(tenants.slug, txSlugSuccess));
      expect(foundSuccess).toBeDefined();

      // 2. Transaction that throws and rolls back
      let txErrorThrown = false;
      try {
        await client.db.transaction(async (tx) => {
          await tx.insert(tenants).values({
            name: "Tx Fail Tenant",
            slug: txSlugFail,
            eventRateLimitPerMinute: 300,
          });
          throw new Error("Simulated rollback error");
        });
      } catch {
        txErrorThrown = true;
      }

      expect(txErrorThrown).toBe(true);

      const [foundFailed] = await client.db
        .select()
        .from(tenants)
        .where(eq(tenants.slug, txSlugFail));
      expect(foundFailed).toBeUndefined();

      // Clean up
      await client.db.delete(tenants).where(eq(tenants.slug, txSlugSuccess));
    } finally {
      await client.close();
    }
  });

  it("handles concurrent queries across the Bun.SQL connection pool", async () => {
    const client = createDatabaseClient({
      connectionString: databaseUrl,
      max: 10,
    });

    try {
      const queries = Array.from(
        { length: 20 },
        (_, i) => client.sql`SELECT ${i} AS item, pg_sleep(0.01)`,
      );
      const results = await Promise.all(queries);

      expect(results).toHaveLength(20);
      results.forEach((res, index) => {
        expect(res[0].item).toBe(index);
      });
    } finally {
      await client.close();
    }
  });

  it("gracefully shuts down connections", async () => {
    const client = createDatabaseClient({ connectionString: databaseUrl });
    const isHealthy = await client.healthCheck();
    expect(isHealthy).toBe(true);

    await client.close();

    // Queries on closed SQL pool should reject
    let closedError = false;
    try {
      await client.sql`SELECT 1`;
    } catch {
      closedError = true;
    }
    expect(closedError).toBe(true);
  });
});
