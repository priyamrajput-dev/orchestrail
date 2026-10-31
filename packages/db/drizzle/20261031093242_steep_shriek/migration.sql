CREATE TYPE "endpoint_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "signing_secret_status" AS ENUM('active', 'revoked', 'retired');--> statement-breakpoint
CREATE TYPE "delivery_status" AS ENUM('pending', 'processing', 'retrying', 'succeeded', 'dead_lettered', 'canceled');--> statement-breakpoint
CREATE TYPE "outbox_message_status" AS ENUM('pending', 'published');--> statement-breakpoint
CREATE TABLE "endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" varchar(255),
	"status" "endpoint_status" DEFAULT 'active'::"endpoint_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "endpoints_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "signing_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"secret_version" integer DEFAULT 1 NOT NULL,
	"ciphertext" text NOT NULL,
	"nonce" text,
	"status" "signing_secret_status" DEFAULT 'active'::"signing_secret_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "signing_secrets_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "endpoint_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_type" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "endpoint_subscriptions_tenant_endpoint_event_unique" UNIQUE("tenant_id","endpoint_id","event_type")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"event_type" varchar(255) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_tenant_id_idempotency_key_unique" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "events_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"status" "delivery_status" DEFAULT 'pending'::"delivery_status" NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"destination_url" text NOT NULL,
	"signing_secret_id" uuid NOT NULL,
	"signing_secret_version" integer NOT NULL,
	"delivery_sequence" integer DEFAULT 1 NOT NULL,
	"replay_of_delivery_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_tenant_event_endpoint_sequence_unique" UNIQUE("tenant_id","event_id","endpoint_id","delivery_sequence")
);
--> statement-breakpoint
CREATE TABLE "outbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"tenant_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"message_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "outbox_message_status" DEFAULT 'pending'::"outbox_message_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"locked_by" varchar(255),
	"locked_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_messages_delivery_message_type_unique" UNIQUE("delivery_id","message_type")
);
--> statement-breakpoint
CREATE INDEX "endpoints_tenant_id_status_idx" ON "endpoints" ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "endpoints_tenant_id_created_at_idx" ON "endpoints" ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "signing_secrets_endpoint_status_idx" ON "signing_secrets" ("endpoint_id","status");--> statement-breakpoint
CREATE INDEX "endpoint_subscriptions_tenant_event_type_idx" ON "endpoint_subscriptions" ("tenant_id","event_type");--> statement-breakpoint
CREATE INDEX "events_tenant_id_created_at_idx" ON "events" ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "events_tenant_id_event_type_created_at_idx" ON "events" ("tenant_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "deliveries_tenant_id_created_at_idx" ON "deliveries" ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "deliveries_tenant_id_status_created_at_idx" ON "deliveries" ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_messages_status_next_attempt_idx" ON "outbox_messages" ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "outbox_messages_tenant_id_created_at_idx" ON "outbox_messages" ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "endpoints" ADD CONSTRAINT "endpoints_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "signing_secrets" ADD CONSTRAINT "signing_secrets_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "signing_secrets" ADD CONSTRAINT "signing_secrets_endpoint_id_endpoints_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "endpoints"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "endpoint_subscriptions" ADD CONSTRAINT "endpoint_subscriptions_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "endpoint_subscriptions" ADD CONSTRAINT "endpoint_subscriptions_endpoint_id_endpoints_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "endpoints"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_event_id_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_endpoint_id_endpoints_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "endpoints"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_signing_secret_id_signing_secrets_id_fkey" FOREIGN KEY ("signing_secret_id") REFERENCES "signing_secrets"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_tenant_id_tenants_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_delivery_id_deliveries_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE;