import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { deliveries } from "./deliveries";
import { tenants } from "./tenants";

export const outboxMessageStatusEnum = pgEnum("outbox_message_status", [
  "pending",
  "published",
]);

export const outboxMessages = pgTable(
  "outbox_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveries.id, { onDelete: "cascade" }),
    messageType: varchar("message_type", { length: 100 }).notNull(),
    payload: jsonb("payload").notNull(),
    status: outboxMessageStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    publishedAt: timestamp("published_at", {
      withTimezone: true,
      mode: "date",
    }),
    lockedBy: varchar("locked_by", { length: 255 }),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("outbox_messages_delivery_message_type_unique").on(
      table.deliveryId,
      table.messageType,
    ),
    index("outbox_messages_status_next_attempt_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    index("outbox_messages_tenant_id_created_at_idx").on(
      table.tenantId,
      table.createdAt,
    ),
  ],
);

export type OutboxMessage = typeof outboxMessages.$inferSelect;
export type NewOutboxMessage = typeof outboxMessages.$inferInsert;
