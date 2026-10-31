import { z } from "zod";

export const EVENT_TYPE_REGEX = /^[a-z0-9]+([._-][a-z0-9]+)*$/;

export const eventIngestionBodySchema = z.object({
  type: z
    .string()
    .trim()
    .min(1, "Event type cannot be empty")
    .max(255, "Event type must be at most 255 characters")
    .regex(
      EVENT_TYPE_REGEX,
      "Event type must follow a lowercase format using letters, numbers, and dot/underscore/hyphen separators (e.g. 'order.completed')",
    ),
  data: z.custom<Record<string, unknown>>(
    (val) => typeof val === "object" && val !== null && !Array.isArray(val),
    {
      message: "Data must be a valid JSON object",
    },
  ),
  occurred_at: z
    .string()
    .datetime({ message: "occurred_at must be a valid ISO-8601 timestamp" })
    .optional(),
});

export type EventIngestionBody = z.infer<typeof eventIngestionBodySchema>;

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1, "Idempotency-Key header cannot be empty")
  .max(255, "Idempotency-Key header must be at most 255 characters");
