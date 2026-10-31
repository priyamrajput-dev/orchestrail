import type {
  DatabaseClient,
  NewDelivery,
  NewOutboxMessage,
} from "@orchestrail/db";
import { AppError } from "../../common/errors/app-error";
import { ERROR_CODES } from "../../common/errors/error-codes";
import {
  calculateEventRequestHash,
  type SemanticEventInput,
} from "./event-hash";
import { EventsRepository } from "./events.repository";
import type { EventIngestionBody } from "./events.schema";

export interface IngestEventParams {
  tenantId: string;
  idempotencyKey: string;
  body: EventIngestionBody;
}

export interface IngestEventResult {
  eventId: string;
  accepted: boolean;
  duplicate: boolean;
  deliveriesCreated: number;
}

export class EventsService {
  constructor(
    private readonly dbClient: DatabaseClient,
    private readonly repository: EventsRepository = new EventsRepository(),
  ) {}

  /**
   * Processes event ingestion transactionally:
   * 1. Calculates request hash.
   * 2. Within a single transaction, attempts conflict-aware insertion on (tenant_id, idempotency_key).
   * 3. If duplicate key, verifies matching request hash (throws IDEMPOTENCY_CONFLICT on mismatch)
   *    and returns existing event result without creating new deliveries or outbox records.
   * 4. For new events, finds active subscribed endpoints, verifies active signing secrets,
   *    and creates delivery + outbox records atomically.
   */
  async ingestEvent(params: IngestEventParams): Promise<IngestEventResult> {
    const { tenantId, idempotencyKey, body } = params;

    // 1. Calculate deterministic request hash
    const semanticInput: SemanticEventInput = {
      type: body.type,
      data: body.data,
      occurred_at: body.occurred_at,
    };
    const requestHash = calculateEventRequestHash(semanticInput);

    // Parse occurred_at date or fall back to current time for DB insertion
    const occurredAt = body.occurred_at
      ? new Date(body.occurred_at)
      : new Date();

    // 2. Execute within a single database transaction
    return await this.dbClient.db.transaction(async (tx) => {
      // 3. Attempt insertion with ON CONFLICT DO NOTHING
      const insertedEvent =
        await this.repository.insertEventOnConflictDoNothing(tx, {
          tenantId,
          eventType: body.type,
          idempotencyKey,
          requestHash,
          payload: body.data,
          occurredAt,
        });

      // 4. Handle idempotency duplicate
      if (!insertedEvent) {
        const existingEvent = await this.repository.findEventByIdempotencyKey(
          tx,
          tenantId,
          idempotencyKey,
        );

        if (!existingEvent) {
          throw new AppError({
            code: ERROR_CODES.INTERNAL_SERVER_ERROR,
            message: "Failed to resolve conflicting event record",
            statusCode: 500,
          });
        }

        // Compare request hashes
        if (existingEvent.requestHash !== requestHash) {
          throw new AppError({
            code: ERROR_CODES.IDEMPOTENCY_CONFLICT,
            message:
              "An event with the same idempotency key exists with a different payload",
            statusCode: 409,
          });
        }

        // Duplicate with identical payload: count existing deliveries without creating new records
        const deliveriesCount = await this.repository.countDeliveriesForEvent(
          tx,
          tenantId,
          existingEvent.id,
        );

        return {
          eventId: existingEvent.id,
          accepted: true,
          duplicate: true,
          deliveriesCreated: deliveriesCount,
        };
      }

      // 5. New event: find active subscribed endpoints
      const matchedEndpoints =
        await this.repository.findMatchingActiveEndpointsAndSecrets(
          tx,
          tenantId,
          body.type,
        );

      // Check for data-integrity failure: active subscribed endpoint missing active signing secret
      for (const endpoint of matchedEndpoints) {
        if (
          !endpoint.signingSecretId ||
          endpoint.signingSecretVersion === null
        ) {
          throw new AppError({
            code: ERROR_CODES.INTERNAL_SERVER_ERROR,
            message: `Data integrity failure: Active endpoint '${endpoint.endpointId}' has no active signing secret`,
            statusCode: 500,
          });
        }
      }

      // If no endpoints match, accept event with zero deliveries
      if (matchedEndpoints.length === 0) {
        return {
          eventId: insertedEvent.id,
          accepted: true,
          duplicate: false,
          deliveriesCreated: 0,
        };
      }

      // 6. Snapshot and construct deliveries
      const newDeliveries: NewDelivery[] = matchedEndpoints.map((ep) => ({
        tenantId,
        eventId: insertedEvent.id,
        endpointId: ep.endpointId,
        status: "pending",
        attemptCount: 0,
        maxAttempts: 5,
        destinationUrl: ep.destinationUrl,
        signingSecretId: ep.signingSecretId!,
        signingSecretVersion: ep.signingSecretVersion!,
        deliverySequence: 1,
      }));

      const createdDeliveries = await this.repository.createDeliveries(
        tx,
        newDeliveries,
      );

      // 7. Create outbox messages for each delivery
      const newOutboxMessages: NewOutboxMessage[] = createdDeliveries.map(
        (del) => ({
          tenantId,
          deliveryId: del.id,
          messageType: "webhook.delivery.requested",
          payload: {
            delivery_id: del.id,
            tenant_id: tenantId,
            message_id: crypto.randomUUID(),
          },
          status: "pending",
          attempts: 0,
        }),
      );

      await this.repository.createOutboxMessages(tx, newOutboxMessages);

      return {
        eventId: insertedEvent.id,
        accepted: true,
        duplicate: false,
        deliveriesCreated: createdDeliveries.length,
      };
    });
  }
}
