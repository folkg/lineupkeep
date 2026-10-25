CREATE TABLE "provider_credentials" (
	"connection_id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"generation" integer NOT NULL,
	"envelope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "credential_generation" integer;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "reconnect_required_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "provider_credentials_user_id_connection_id_idx" ON "provider_credentials" ("user_id","connection_id");