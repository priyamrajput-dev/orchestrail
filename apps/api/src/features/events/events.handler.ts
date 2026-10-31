import type { Context } from "hono";
import { AppError } from "../../common/errors/app-error";
import { ERROR_CODES } from "../../common/errors/error-codes";
import { config } from "../../config/env";
import type { EventsService } from "./events.service";
import {
  eventIngestionBodySchema,
  idempotencyKeySchema,
} from "./events.schema";

export class EventsHandler {
  constructor(private readonly eventsService: EventsService) {}

  handleIngestEvent = async (c: Context) => {
    const tenantId = c.get("tenantId") as string | undefined;
    if (!tenantId) {
      throw new AppError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: "Missing authenticated tenant context",
        statusCode: 401,
      });
    }

    // 1. Validate Idempotency-Key header presence and format
    const rawIdempotencyKey = c.req.header("idempotency-key");
    if (!rawIdempotencyKey || rawIdempotencyKey.trim().length === 0) {
      throw new AppError({
        code: ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
        message: "Idempotency-Key header is required",
        statusCode: 400,
      });
    }

    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);

    // 2. Validate payload size limit before expensive operations
    const contentLength = c.req.header("content-length");
    if (contentLength) {
      const parsedLength = parseInt(contentLength, 10);
      if (!isNaN(parsedLength) && parsedLength > config.MAX_EVENT_BODY_BYTES) {
        throw new AppError({
          code: ERROR_CODES.PAYLOAD_TOO_LARGE,
          message: `Request payload exceeds size limit of ${config.MAX_EVENT_BODY_BYTES} bytes`,
          statusCode: 413,
        });
      }
    }

    // Read raw body text and enforce byte limit
    const rawBody = await c.req.text();
    const byteLength = Buffer.byteLength(rawBody, "utf8");
    if (byteLength > config.MAX_EVENT_BODY_BYTES) {
      throw new AppError({
        code: ERROR_CODES.PAYLOAD_TOO_LARGE,
        message: `Request payload exceeds size limit of ${config.MAX_EVENT_BODY_BYTES} bytes`,
        statusCode: 413,
      });
    }

    // Parse JSON safely
    let jsonBody: unknown;
    try {
      jsonBody = JSON.parse(rawBody);
    } catch {
      throw new AppError({
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Malformed JSON payload in request body",
        statusCode: 400,
      });
    }

    // 3. Validate event body schema
    const validatedBody = eventIngestionBodySchema.parse(jsonBody);

    // 4. Ingest event
    const result = await this.eventsService.ingestEvent({
      tenantId,
      idempotencyKey,
      body: validatedBody,
    });

    const responsePayload = {
      event_id: result.eventId,
      accepted: true,
      duplicate: result.duplicate,
      deliveries_created: result.deliveriesCreated,
    };

    // New event: HTTP 202 Accepted; Duplicate: HTTP 200 OK
    const statusCode = result.duplicate ? 200 : 202;
    return c.json(responsePayload, statusCode);
  };
}
