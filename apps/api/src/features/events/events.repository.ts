import { and, eq, sql } from "drizzle-orm";
import {
  deliveries,
  endpoints,
  endpointSubscriptions,
  events,
  outboxMessages,
  signingSecrets,
  type Delivery,
  type Event,
  type NewDelivery,
  type NewOutboxMessage,
  type OutboxMessage,
} from "@orchestrail/db";

// Use Any transaction or database executor type compatible with Drizzle Bun.SQL
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TransactionExecutor = any;

export interface MatchedEndpointRow {
  endpointId: string;
  destinationUrl: string;
  signingSecretId: string | null;
  signingSecretVersion: number | null;
}

export class EventsRepository {
  /**
   * Attempts to insert a new event row. If (tenant_id, idempotency_key) conflicts,
   * it does nothing and returns null.
   */
  async insertEventOnConflictDoNothing(
    tx: TransactionExecutor,
    params: {
      tenantId: string;
      eventType: string;
      idempotencyKey: string;
      requestHash: string;
      payload: Record<string, unknown>;
      occurredAt: Date;
    },
  ): Promise<Event | null> {
    const [inserted] = await tx
      .insert(events)
      .values({
        tenantId: params.tenantId,
        eventType: params.eventType,
        idempotencyKey: params.idempotencyKey,
        requestHash: params.requestHash,
        payload: params.payload,
        occurredAt: params.occurredAt,
      })
      .onConflictDoNothing({
        target: [events.tenantId, events.idempotencyKey],
      })
      .returning();

    return inserted ?? null;
  }

  /**
   * Finds an existing event by tenant ID and idempotency key.
   */
  async findEventByIdempotencyKey(
    tx: TransactionExecutor,
    tenantId: string,
    idempotencyKey: string,
  ): Promise<Event | null> {
    const [existing] = await tx
      .select()
      .from(events)
      .where(
        and(
          eq(events.tenantId, tenantId),
          eq(events.idempotencyKey, idempotencyKey),
        ),
      );

    return existing ?? null;
  }

  /**
   * Counts existing deliveries for an event within a tenant.
   */
  async countDeliveriesForEvent(
    tx: TransactionExecutor,
    tenantId: string,
    eventId: string,
  ): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(deliveries)
      .where(
        and(eq(deliveries.tenantId, tenantId), eq(deliveries.eventId, eventId)),
      );

    return Number(row?.count ?? 0);
  }

  /**
   * Finds all active endpoints subscribed to the given event type for a tenant,
   * along with their active signing secrets.
   */
  async findMatchingActiveEndpointsAndSecrets(
    tx: TransactionExecutor,
    tenantId: string,
    eventType: string,
  ): Promise<MatchedEndpointRow[]> {
    const rows = await tx
      .select({
        endpointId: endpoints.id,
        destinationUrl: endpoints.url,
        signingSecretId: signingSecrets.id,
        signingSecretVersion: signingSecrets.secretVersion,
      })
      .from(endpoints)
      .innerJoin(
        endpointSubscriptions,
        and(
          eq(endpointSubscriptions.endpointId, endpoints.id),
          eq(endpointSubscriptions.tenantId, tenantId),
          eq(endpointSubscriptions.eventType, eventType),
        ),
      )
      .leftJoin(
        signingSecrets,
        and(
          eq(signingSecrets.endpointId, endpoints.id),
          eq(signingSecrets.tenantId, tenantId),
          eq(signingSecrets.status, "active"),
        ),
      )
      .where(
        and(eq(endpoints.tenantId, tenantId), eq(endpoints.status, "active")),
      );

    return rows;
  }

  /**
   * Inserts deliveries in batch.
   */
  async createDeliveries(
    tx: TransactionExecutor,
    newDeliveries: NewDelivery[],
  ): Promise<Delivery[]> {
    if (newDeliveries.length === 0) return [];
    return await tx.insert(deliveries).values(newDeliveries).returning();
  }

  /**
   * Inserts outbox messages in batch.
   */
  async createOutboxMessages(
    tx: TransactionExecutor,
    newMessages: NewOutboxMessage[],
  ): Promise<OutboxMessage[]> {
    if (newMessages.length === 0) return [];
    return await tx.insert(outboxMessages).values(newMessages).returning();
  }
}
