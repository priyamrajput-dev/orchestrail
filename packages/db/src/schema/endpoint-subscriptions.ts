import {
  index,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { endpoints } from "./endpoints";
import { tenants } from "./tenants";

export const endpointSubscriptions = pgTable(
  "endpoint_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => endpoints.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("endpoint_subscriptions_tenant_endpoint_event_unique").on(
      table.tenantId,
      table.endpointId,
      table.eventType,
    ),
    index("endpoint_subscriptions_tenant_event_type_idx").on(
      table.tenantId,
      table.eventType,
    ),
  ],
);

export type EndpointSubscription = typeof endpointSubscriptions.$inferSelect;
export type NewEndpointSubscription = typeof endpointSubscriptions.$inferInsert;
