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
import { tenants } from "./tenants";

export const signingSecretStatusEnum = pgEnum("signing_secret_status", [
  "active",
  "revoked",
  "retired",
]);

export const signingSecrets = pgTable(
  "signing_secrets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => endpoints.id, { onDelete: "cascade" }),
    secretVersion: integer("secret_version").notNull().default(1),
    ciphertext: text("ciphertext").notNull(),
    nonce: text("nonce"),
    status: signingSecretStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("signing_secrets_tenant_id_id_unique").on(table.tenantId, table.id),
    index("signing_secrets_endpoint_status_idx").on(
      table.endpointId,
      table.status,
    ),
  ],
);

export type SigningSecret = typeof signingSecrets.$inferSelect;
export type NewSigningSecret = typeof signingSecrets.$inferInsert;
