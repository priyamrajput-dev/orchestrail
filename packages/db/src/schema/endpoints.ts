import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const endpointStatusEnum = pgEnum("endpoint_status", [
  "active",
  "disabled",
]);

export const endpoints = pgTable(
  "endpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    description: varchar("description", { length: 255 }),
    status: endpointStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("endpoints_tenant_id_id_unique").on(table.tenantId, table.id),
    index("endpoints_tenant_id_status_idx").on(table.tenantId, table.status),
    index("endpoints_tenant_id_created_at_idx").on(
      table.tenantId,
      table.createdAt,
    ),
  ],
);

export type Endpoint = typeof endpoints.$inferSelect;
export type NewEndpoint = typeof endpoints.$inferInsert;
