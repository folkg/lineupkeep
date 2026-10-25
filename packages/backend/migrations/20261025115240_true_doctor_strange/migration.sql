CREATE TABLE "connection_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"credential_generation" integer NOT NULL,
	"status" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY,
	"user_id" text NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "connection_incidents_connection_generation_idx" ON "connection_incidents" ("connection_id","credential_generation");--> statement-breakpoint
CREATE INDEX "connection_incidents_user_id_status_idx" ON "connection_incidents" ("user_id","status");--> statement-breakpoint
CREATE INDEX "connection_incidents_status_resolved_at_idx" ON "connection_incidents" ("status","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_incident_id_idx" ON "notifications" ("incident_id");--> statement-breakpoint
CREATE INDEX "notifications_status_next_attempt_at_idx" ON "notifications" ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications" ("user_id","created_at");