import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createDatabaseClient,
  deliveries,
  endpoints,
  endpointSubscriptions,
  events,
  outboxMessages,
  signingSecrets,
  tenants,
  type DatabaseClient,
} from "@orchestrail/db";
import { and, eq } from "drizzle-orm";
import { createApplication } from "../src/app";
import {
  calculateEventRequestHash,
  canonicalJsonStringify,
} from "../src/features/events/event-hash";
import { EventsRepository } from "../src/features/events/events.repository";
import { EventsService } from "../src/features/events/events.service";
import { provisionTenant } from "../src/features/tenants/tenant-provisioning.service";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://orchestrail_user:dev_postgres_password_123@localhost:5432/orchestrail_dev";

describe("Milestone 6: Event Ingestion, Idempotency and Transactional Outbox", () => {
  let dbClient: DatabaseClient;
  let app: ReturnType<typeof createApplication>;

  beforeAll(() => {
    dbClient = createDatabaseClient({ connectionString: databaseUrl });
    app = createApplication({ dbClient });
  });

  afterAll(async () => {
    await dbClient.close();
  });

  describe("Canonical Request Hashing", () => {
    it("serializes objects with sorted keys regardless of original insertion order", () => {
      const obj1 = { b: 2, a: 1, c: { y: 20, x: 10 } };
      const obj2 = { a: 1, c: { x: 10, y: 20 }, b: 2 };

      expect(canonicalJsonStringify(obj1)).toBe(canonicalJsonStringify(obj2));
      expect(canonicalJsonStringify(obj1)).toBe(
        '{"a":1,"b":2,"c":{"x":10,"y":20}}',
      );
    });

    it("generates identical SHA-256 hash for logically equivalent payloads with differing key order", () => {
      const hash1 = calculateEventRequestHash({
        type: "order.completed",
        data: {
          order_id: "ord_123",
          amount: 2500,
          currency: "INR",
          metadata: { customer_type: "retail", tier: "gold" },
        },
      });

      const hash2 = calculateEventRequestHash({
        type: "order.completed",
        data: {
          currency: "INR",
          amount: 2500,
          metadata: { tier: "gold", customer_type: "retail" },
          order_id: "ord_123",
        },
      });

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it("preserves array ordering as semantically significant", () => {
      const hash1 = calculateEventRequestHash({
        type: "items.sorted",
        data: { items: [1, 2, 3] },
      });
      const hash2 = calculateEventRequestHash({
        type: "items.sorted",
        data: { items: [3, 2, 1] },
      });

      expect(hash1).not.toBe(hash2);
    });

    it("handles primitives, nulls, booleans, and strings deterministically", () => {
      const hash = calculateEventRequestHash({
        type: "test.primitives",
        data: {
          flag: true,
          count: 0,
          empty: null,
          nested: { active: false },
        },
      });
      expect(hash).toBeString();
      expect(hash).toHaveLength(64);
    });

    it("includes explicit occurred_at in hash when supplied, but produces different hash without it", () => {
      const hashWith = calculateEventRequestHash({
        type: "payment.succeeded",
        data: { amount: 500 },
        occurred_at: "2026-10-31T10:00:00.000Z",
      });

      const hashWithout = calculateEventRequestHash({
        type: "payment.succeeded",
        data: { amount: 500 },
      });

      expect(hashWith).not.toBe(hashWithout);
    });
  });

  describe("API Validation & Error Handling", () => {
    let authHeader: string;
    let tenantId: string;

    beforeAll(async () => {
      const prov = await provisionTenant(dbClient, {
        name: "Validation Test Tenant",
        slug: `val-test-${Date.now()}`,
      });
      tenantId = prov.tenant.id;
      authHeader = `Bearer ${prov.apiKey.plaintextKey}`;
    });

    afterAll(async () => {
      await dbClient.db.delete(tenants).where(eq(tenants.id, tenantId));
    });

    it("rejects request without Authorization header with 401", async () => {
      const res = await app.request("/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "key-123",
        },
        body: JSON.stringify({
          type: "order.completed",
          data: { id: "1" },
        }),
      });

      expect(res.status).toBe(401);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects request without Idempotency-Key header with 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
      const res = await app.request("/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          type: "order.completed",
          data: { id: "1" },
        }),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
      expect(json.error.message).toContain(
        "Idempotency-Key header is required",
      );
    });

    it("rejects invalid event type with 400 VALIDATION_ERROR", async () => {
      const res = await app.request("/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          "Idempotency-Key": "key-invalid-type",
        },
        body: JSON.stringify({
          type: "Order Completed!!", // uppercase and punctuation not allowed
          data: { id: "1" },
        }),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects non-object data payload with 400 VALIDATION_ERROR", async () => {
      const res = await app.request("/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          "Idempotency-Key": "key-invalid-data",
        },
        body: JSON.stringify({
          type: "order.completed",
          data: "not an object",
        }),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects oversized request body with 413 PAYLOAD_TOO_LARGE", async () => {
      // 256 KiB = 262144 bytes; generate > 262144 bytes payload
      const largeString = "x".repeat(270000);
      const res = await app.request("/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          "Idempotency-Key": "key-oversized",
        },
        body: JSON.stringify({
          type: "order.completed",
          data: { big: largeString },
        }),
      });

      expect(res.status).toBe(413);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe("PAYLOAD_TOO_LARGE");
    });
  });

  describe("Subscription Matching & Transactional Delivery/Outbox Creation", () => {
    let authHeader: string;
    let tenantId: string;
    let otherTenantAuth: string;
    let otherTenantId: string;

    beforeAll(async () => {
      // Create primary tenant
      const prov1 = await provisionTenant(dbClient, {
        name: "Events Primary Tenant",
        slug: `events-prim-${Date.now()}`,
      });
      tenantId = prov1.tenant.id;
      authHeader = `Bearer ${prov1.apiKey.plaintextKey}`;

      // Create secondary tenant to verify isolation
      const prov2 = await provisionTenant(dbClient, {
        name: "Events Other Tenant",
        slug: `events-other-${Date.now()}`,
      });
      otherTenantId = prov2.tenant.id;
      otherTenantAuth = `Bearer ${prov2.apiKey.plaintextKey}`;
    });

    afterAll(async () => {
      await dbClient.db.delete(tenants).where(eq(tenants.id, tenantId));
      await dbClient.db.delete(tenants).where(eq(tenants.id, otherTenantId));
    });

    it("accepts event with 202 and 0 deliveries when no endpoints are subscribed", async () => {
      const res = await app.request("/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          "Idempotency-Key": "key-no-sub-1",
        },
        body: JSON.stringify({
          type: "invoice.generated",
          data: { invoice_id: "inv_123" },
        }),
      });

      expect(res.status).toBe(202);
      const body = (await res.json()) as any;
      expect(body.accepted).toBe(true);
      expect(body.duplicate).toBe(false);
      expect(body.deliveries_created).toBe(0);
      expect(body.event_id).toBeString();

      // Verify event row in DB
      const [storedEvent] = await dbClient.db
        .select()
        .from(events)
        .where(eq(events.id, body.event_id));
      expect(storedEvent).toBeDefined();
      expect(storedEvent?.eventType).toBe("invoice.generated");
    });

    it("creates snapshot deliveries and outbox messages for multiple matching active endpoints", async () => {
      // Create 2 active endpoints subscribed to "order.created" with active signing secrets
      const [ep1] = await dbClient.db
        .insert(endpoints)
        .values({
          tenantId,
          url: "https://api.merchant.com/webhook1",
          status: "active",
        })
        .returning();

      expect(ep1).toBeDefined();

      const [sec1] = await dbClient.db
        .insert(signingSecrets)
        .values({
          tenantId,
          endpointId: ep1!.id,
          secretVersion: 1,
          ciphertext: "cipher_sec_1",
          status: "active",
        })
        .returning();

      expect(sec1).toBeDefined();

      await dbClient.db.insert(endpointSubscriptions).values({
        tenantId,
        endpointId: ep1!.id,
        eventType: "order.created",
      });

      const [ep2] = await dbClient.db
        .insert(endpoints)
        .values({
          tenantId,
          url: "https://api.merchant.com/webhook2",
          status: "active",
        })
        .returning();

      expect(ep2).toBeDefined();

      const [sec2] = await dbClient.db
        .insert(signingSecrets)
        .values({
          tenantId,
          endpointId: ep2!.id,
          secretVersion: 2,
          ciphertext: "cipher_sec_2",
          status: "active",
        })
        .returning();

      expect(sec2).toBeDefined();

      await dbClient.db.insert(endpointSubscriptions).values({
        tenantId,
        endpointId: ep2!.id,
        eventType: "order.created",
      });

      // Ingest event
      const res = await app.request("/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          "Idempotency-Key": "key-order-1",
        },
        body: JSON.stringify({
          type: "order.created",
          data: { order_id: "ord_999", total: 100 },
        }),
      });

      expect(res.status).toBe(202);
      const body = (await res.json()) as any;
      expect(body.accepted).toBe(true);
      expect(body.duplicate).toBe(false);
      expect(body.deliveries_created).toBe(2);

      // Verify deliveries in DB
      const dbDeliveries = await dbClient.db
        .select()
        .from(deliveries)
        .where(
          and(
            eq(deliveries.tenantId, tenantId),
            eq(deliveries.eventId, body.event_id),
          ),
        );

      expect(dbDeliveries).toHaveLength(2);
      expect(dbDeliveries.map((d) => d.destinationUrl).sort()).toEqual([
        "https://api.merchant.com/webhook1",
        "https://api.merchant.com/webhook2",
      ]);
      expect(dbDeliveries.every((d) => d.status === "pending")).toBe(true);
      expect(dbDeliveries.every((d) => d.deliverySequence === 1)).toBe(true);

      // Verify outbox messages in DB
      const dbOutbox = await dbClient.db
        .select()
        .from(outboxMessages)
        .where(eq(outboxMessages.tenantId, tenantId));

      const relevantOutbox = dbOutbox.filter((m) =>
        dbDeliveries.some((d) => d.id === m.deliveryId),
      );
      expect(relevantOutbox).toHaveLength(2);
      expect(
        relevantOutbox.every(
          (m) =>
            m.messageType === "webhook.delivery.requested" &&
            m.status === "pending",
        ),
      ).toBe(true);
      expect(
        relevantOutbox.every(
          (m) => (m.payload as any).delivery_id && (m.payload as any).tenant_id,
        ),
      ).toBe(true);
    });

    it("does not create deliveries for disabled endpoints or non-matching event types", async () => {
      // 1. Endpoint subscribed to "user.signup" but status is "disabled"
      const [disabledEp] = await dbClient.db
        .insert(endpoints)
        .values({
          tenantId,
          url: "https://disabled.com/hook",
          status: "disabled",
        })
        .returning();

      expect(disabledEp).toBeDefined();

      await dbClient.db.insert(signingSecrets).values({
        tenantId,
        endpointId: disabledEp!.id,
        secretVersion: 1,
        ciphertext: "cipher_dis",
        status: "active",
      });

      await dbClient.db.insert(endpointSubscriptions).values({
        tenantId,
        endpointId: disabledEp!.id,
        eventType: "user.signup",
      });

      // 2. Endpoint active but subscribed to different event "user.deleted"
      const [diffEventEp] = await dbClient.db
        .insert(endpoints)
        .values({
          tenantId,
          url: "https://different.com/hook",
          status: "active",
        })
        .returning();

      expect(diffEventEp).toBeDefined();

      await dbClient.db.insert(signingSecrets).values({
        tenantId,
        endpointId: diffEventEp!.id,
        secretVersion: 1,
        ciphertext: "cipher_diff",
        status: "active",
      });

      await dbClient.db.insert(endpointSubscriptions).values({
        tenantId,
        endpointId: diffEventEp!.id,
        eventType: "user.deleted",
      });

      // Ingest "user.signup"
      const res = await app.request("/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          "Idempotency-Key": "key-signup-1",
        },
        body: JSON.stringify({
          type: "user.signup",
          data: { user_id: "usr_1" },
        }),
      });

      expect(res.status).toBe(202);
      const body = (await res.json()) as any;
      expect(body.deliveries_created).toBe(0);

      // Verify no deliveries created for disabled or non-matching endpoints
      const delRows = await dbClient.db
        .select()
        .from(deliveries)
        .where(
          and(
            eq(deliveries.tenantId, tenantId),
            eq(deliveries.eventId, body.event_id),
          ),
        );
      expect(delRows).toHaveLength(0);
    });

    it("never selects cross-tenant endpoints", async () => {
      // Create endpoint for other tenant subscribed to "product.updated"
      const [otherEp] = await dbClient.db
        .insert(endpoints)
        .values({
          tenantId: otherTenantId,
          url: "https://other-tenant.com/hook",
          status: "active",
        })
        .returning();

      expect(otherEp).toBeDefined();

      await dbClient.db.insert(signingSecrets).values({
        tenantId: otherTenantId,
        endpointId: otherEp!.id,
        secretVersion: 1,
        ciphertext: "other_sec",
        status: "active",
      });

      await dbClient.db.insert(endpointSubscriptions).values({
        tenantId: otherTenantId,
        endpointId: otherEp!.id,
        eventType: "product.updated",
      });

      // Primary tenant ingests "product.updated"
      const res = await app.request("/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          "Idempotency-Key": "key-prod-1",
        },
        body: JSON.stringify({
          type: "product.updated",
          data: { product_id: "p_1" },
        }),
      });

      expect(res.status).toBe(202);
      const body = (await res.json()) as any;
      // Must be 0 because the only endpoint subscribed to this belongs to another tenant
      expect(body.deliveries_created).toBe(0);

      // Verify no deliveries exist for other tenant endpoint
      const otherDeliveries = await dbClient.db
        .select()
        .from(deliveries)
        .where(eq(deliveries.endpointId, otherEp!.id));
      expect(otherDeliveries).toHaveLength(0);
    });

    it("fails safely with 500 when active subscribed endpoint has no active signing secret and rolls back transaction", async () => {
      // Create active endpoint subscribed to "secret.missing" with NO active secret (or revoked secret)
      const [noSecEp] = await dbClient.db
        .insert(endpoints)
        .values({
          tenantId,
          url: "https://missing-secret.com/hook",
          status: "active",
        })
        .returning();

      expect(noSecEp).toBeDefined();

      // Insert only revoked secret
      await dbClient.db.insert(signingSecrets).values({
        tenantId,
        endpointId: noSecEp!.id,
        secretVersion: 1,
        ciphertext: "revoked_cipher",
        status: "revoked",
      });

      await dbClient.db.insert(endpointSubscriptions).values({
        tenantId,
        endpointId: noSecEp!.id,
        eventType: "secret.missing",
      });

      const res = await app.request("/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          "Idempotency-Key": "key-missing-sec",
        },
        body: JSON.stringify({
          type: "secret.missing",
          data: { item: 123 },
        }),
      });

      expect(res.status).toBe(500);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe("INTERNAL_SERVER_ERROR");

      // Verify complete rollback: no event was created in DB
      const [foundEvent] = await dbClient.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.tenantId, tenantId),
            eq(events.idempotencyKey, "key-missing-sec"),
          ),
        );
      expect(foundEvent).toBeUndefined();
    });
  });

  describe("Idempotency & Concurrency", () => {
    let authHeader: string;
    let tenantId: string;
    let epId: string;

    beforeAll(async () => {
      const prov = await provisionTenant(dbClient, {
        name: "Idempotency Test Tenant",
        slug: `idem-test-${Date.now()}`,
      });
      tenantId = prov.tenant.id;
      authHeader = `Bearer ${prov.apiKey.plaintextKey}`;

      // Set up 1 active subscribed endpoint
      const [ep] = await dbClient.db
        .insert(endpoints)
        .values({
          tenantId,
          url: "https://api.idem.com/hook",
          status: "active",
        })
        .returning();
      expect(ep).toBeDefined();
      epId = ep!.id;

      await dbClient.db.insert(signingSecrets).values({
        tenantId,
        endpointId: epId,
        secretVersion: 1,
        ciphertext: "sec_cipher",
        status: "active",
      });

      await dbClient.db.insert(endpointSubscriptions).values({
        tenantId,
        endpointId: epId,
        eventType: "payment.completed",
      });
    });

    afterAll(async () => {
      await dbClient.db.delete(tenants).where(eq(tenants.id, tenantId));
    });

    it("returns HTTP 200 with duplicate=true and same delivery count for identical retries", async () => {
      const payload = {
        type: "payment.completed",
        data: { payment_id: "pay_100", amount: 1500 },
      };

      // 1. Initial request
      const res1 = await app.request("/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          "Idempotency-Key": "key-idem-exact",
        },
        body: JSON.stringify(payload),
      });

      expect(res1.status).toBe(202);
      const body1 = (await res1.json()) as any;
      expect(body1.accepted).toBe(true);
      expect(body1.duplicate).toBe(false);
      expect(body1.deliveries_created).toBe(1);

      // 2. Identical duplicate request (different payload key order to verify canonical hashing)
      const duplicatePayload = {
        type: "payment.completed",
        data: { amount: 1500, payment_id: "pay_100" },
      };

      const res2 = await app.request("/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          "Idempotency-Key": "key-idem-exact",
        },
        body: JSON.stringify(duplicatePayload),
      });

      expect(res2.status).toBe(200);
      const body2 = (await res2.json()) as any;
      expect(body2.event_id).toBe(body1.event_id);
      expect(body2.accepted).toBe(true);
      expect(body2.duplicate).toBe(true);
      expect(body2.deliveries_created).toBe(1);

      // 3. Verify in DB: exactly 1 event, 1 delivery, 1 outbox message
      const dbEvents = await dbClient.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.tenantId, tenantId),
            eq(events.idempotencyKey, "key-idem-exact"),
          ),
        );
      expect(dbEvents).toHaveLength(1);

      const dbDelivs = await dbClient.db
        .select()
        .from(deliveries)
        .where(eq(deliveries.eventId, body1.event_id));
      expect(dbDelivs).toHaveLength(1);

      const dbOutbox = await dbClient.db
        .select()
        .from(outboxMessages)
        .where(eq(outboxMessages.deliveryId, dbDelivs[0]!.id));
      expect(dbOutbox).toHaveLength(1);
    });

    it("returns HTTP 409 IDEMPOTENCY_CONFLICT when same key is sent with different payload", async () => {
      const payload1 = {
        type: "payment.completed",
        data: { payment_id: "pay_200", amount: 100 },
      };

      // Initial request
      const res1 = await app.request("/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          "Idempotency-Key": "key-conflict-test",
        },
        body: JSON.stringify(payload1),
      });
      expect(res1.status).toBe(202);

      // Second request with conflicting payload
      const conflictingPayload = {
        type: "payment.completed",
        data: { payment_id: "pay_200", amount: 999 }, // different amount!
      };

      const res2 = await app.request("/v1/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authHeader,
          "Idempotency-Key": "key-conflict-test",
        },
        body: JSON.stringify(conflictingPayload),
      });

      expect(res2.status).toBe(409);
      const json2 = (await res2.json()) as any;
      expect(json2.error.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(json2.error.message).toContain(
        "An event with the same idempotency key exists with a different payload",
      );
    });

    it("handles concurrent identical requests safely: exactly 1 creates event (202), others receive 200 duplicate", async () => {
      const key = `conc-ident-${Date.now()}`;
      const payload = {
        type: "payment.completed",
        data: { payment_id: "pay_conc", amount: 50 },
      };

      const requests = Array.from({ length: 10 }, () =>
        app.request("/v1/events", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
            "Idempotency-Key": key,
          },
          body: JSON.stringify(payload),
        }),
      );

      const responses = await Promise.all(requests);
      const statuses = responses.map((r) => r.status);

      // Exactly 1 request should be 202 Accepted; remaining 9 should be 200 OK
      const count202 = statuses.filter((s) => s === 202).length;
      const count200 = statuses.filter((s) => s === 200).length;

      expect(count202).toBe(1);
      expect(count200).toBe(9);

      // Verify exactly 1 event created in DB
      const dbRows = await dbClient.db
        .select()
        .from(events)
        .where(
          and(eq(events.tenantId, tenantId), eq(events.idempotencyKey, key)),
        );
      expect(dbRows).toHaveLength(1);

      // Verify exactly 1 delivery created
      const delRows = await dbClient.db
        .select()
        .from(deliveries)
        .where(eq(deliveries.eventId, dbRows[0]!.id));
      expect(delRows).toHaveLength(1);
    });

    it("handles concurrent conflicting requests safely: exactly 1 accepted (202), others rejected with 409", async () => {
      const key = `conc-conf-${Date.now()}`;

      // Launch 5 conflicting payloads concurrently with same idempotency key
      const requests = Array.from({ length: 5 }, (_, idx) =>
        app.request("/v1/events", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
            "Idempotency-Key": key,
          },
          body: JSON.stringify({
            type: "payment.completed",
            data: { payment_id: `pay_conf_${idx}`, amount: idx * 100 },
          }),
        }),
      );

      const responses = await Promise.all(requests);
      const statuses = responses.map((r) => r.status);

      const count202 = statuses.filter((s) => s === 202).length;
      const count409 = statuses.filter((s) => s === 409).length;

      expect(count202).toBe(1);
      expect(count409).toBe(4);

      // Exactly 1 event in database
      const dbRows = await dbClient.db
        .select()
        .from(events)
        .where(
          and(eq(events.tenantId, tenantId), eq(events.idempotencyKey, key)),
        );
      expect(dbRows).toHaveLength(1);
    });
  });

  describe("Transaction Atomicity & Rollback", () => {
    let tenantId: string;

    beforeAll(async () => {
      const prov = await provisionTenant(dbClient, {
        name: "Atomicity Test Tenant",
        slug: `atom-test-${Date.now()}`,
      });
      tenantId = prov.tenant.id;
    });

    afterAll(async () => {
      await dbClient.db.delete(tenants).where(eq(tenants.id, tenantId));
    });

    it("rolls back event and deliveries if outbox creation throws an error", async () => {
      // Create an endpoint
      const [ep] = await dbClient.db
        .insert(endpoints)
        .values({
          tenantId,
          url: "https://atomicity.com/hook",
          status: "active",
        })
        .returning();

      expect(ep).toBeDefined();

      await dbClient.db.insert(signingSecrets).values({
        tenantId,
        endpointId: ep!.id,
        secretVersion: 1,
        ciphertext: "sec",
        status: "active",
      });

      await dbClient.db.insert(endpointSubscriptions).values({
        tenantId,
        endpointId: ep!.id,
        eventType: "atomicity.test",
      });

      // Create a repository mock that fails on outbox creation
      class FailingOutboxRepo extends EventsRepository {
        override async createOutboxMessages(): Promise<any> {
          throw new Error("Simulated Outbox Disk/Network Failure");
        }
      }

      const failingService = new EventsService(
        dbClient,
        new FailingOutboxRepo(),
      );

      let threw = false;
      try {
        await failingService.ingestEvent({
          tenantId,
          idempotencyKey: "key-atom-fail-outbox",
          body: {
            type: "atomicity.test",
            data: { test: true },
          },
        });
      } catch (err: any) {
        threw = true;
        expect(err.message).toBe("Simulated Outbox Disk/Network Failure");
      }

      expect(threw).toBe(true);

      // Verify that NEITHER event NOR delivery was committed to PostgreSQL
      const [foundEvent] = await dbClient.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.tenantId, tenantId),
            eq(events.idempotencyKey, "key-atom-fail-outbox"),
          ),
        );
      expect(foundEvent).toBeUndefined();

      const foundDeliveries = await dbClient.db
        .select()
        .from(deliveries)
        .where(
          and(
            eq(deliveries.tenantId, tenantId),
            eq(deliveries.endpointId, ep!.id),
          ),
        );
      expect(foundDeliveries).toHaveLength(0);
    });

    it("rolls back event if delivery creation throws an error", async () => {
      // Create an endpoint
      const [ep] = await dbClient.db
        .insert(endpoints)
        .values({
          tenantId,
          url: "https://delivery-fail.com/hook",
          status: "active",
        })
        .returning();

      expect(ep).toBeDefined();

      await dbClient.db.insert(signingSecrets).values({
        tenantId,
        endpointId: ep!.id,
        secretVersion: 1,
        ciphertext: "sec",
        status: "active",
      });

      await dbClient.db.insert(endpointSubscriptions).values({
        tenantId,
        endpointId: ep!.id,
        eventType: "delivery.test",
      });

      // Create a repository mock that fails on delivery creation
      class FailingDeliveryRepo extends EventsRepository {
        override async createDeliveries(): Promise<any> {
          throw new Error("Simulated Delivery Creation Failure");
        }
      }

      const failingService = new EventsService(
        dbClient,
        new FailingDeliveryRepo(),
      );

      let threw = false;
      try {
        await failingService.ingestEvent({
          tenantId,
          idempotencyKey: "key-atom-fail-delivery",
          body: {
            type: "delivery.test",
            data: { test: true },
          },
        });
      } catch (err: any) {
        threw = true;
        expect(err.message).toBe("Simulated Delivery Creation Failure");
      }

      expect(threw).toBe(true);

      // Verify event was NOT committed to DB
      const [foundEvent] = await dbClient.db
        .select()
        .from(events)
        .where(
          and(
            eq(events.tenantId, tenantId),
            eq(events.idempotencyKey, "key-atom-fail-delivery"),
          ),
        );
      expect(foundEvent).toBeUndefined();
    });
  });
});
