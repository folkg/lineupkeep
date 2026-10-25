CREATE TABLE "provider_connections" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "notes";--> statement-breakpoint
CREATE INDEX "provider_connections_user_id_id_idx" ON "provider_connections" ("user_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_connections_user_id_request_id_idx" ON "provider_connections" ("user_id","request_id");