CREATE TYPE "tenant_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL UNIQUE,
	"status" "tenant_status" DEFAULT 'active'::"tenant_status" NOT NULL,
	"event_rate_limit_per_minute" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_rate_limit_per_minute_positive" CHECK ("event_rate_limit_per_minute" > 0)
);
