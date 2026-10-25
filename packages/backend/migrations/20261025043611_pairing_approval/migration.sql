ALTER TABLE "provider_connections" ADD COLUMN "pairing_code" text NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "approved_at" timestamp with time zone;