import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { endpoints } from "./endpoints";
import { events } from "./events";
import { signingSecrets } from "./signing-secrets";
import { tenants } from "./tenants";

export const deliveryStatusEnum = pgEnum("delivery_status", [
  "pending",
  "processing",
  "retrying",
  "succeeded",
  "dead_lettered",
  "canceled",
]);

export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => endpoints.id, { onDelete: "cascade" }),
    status: deliveryStatusEnum("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
      mode: "date",
    }),
    destinationUrl: text("destination_url").notNull(),
    signingSecretId: uuid("signing_secret_id")
      .notNull()
      .references(() => signingSecrets.id, { onDelete: "restrict" }),
    signingSecretVersion: integer("signing_secret_version").notNull(),
    deliverySequence: integer("delivery_sequence").notNull().default(1),
    replayOfDeliveryId: uuid("replay_of_delivery_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("deliveries_tenant_event_endpoint_sequence_unique").on(
      table.tenantId,
      table.eventId,
      table.endpointId,
      table.deliverySequence,
    ),
    index("deliveries_tenant_id_created_at_idx").on(
      table.tenantId,
      table.createdAt,
    ),
    index("deliveries_tenant_id_status_created_at_idx").on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
  ],
);

export type Delivery = typeof deliveries.$inferSelect;
export type NewDelivery = typeof deliveries.$inferInsert;
