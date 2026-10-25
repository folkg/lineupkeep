CREATE TABLE "lineup_deliveries" (
	"id" uuid PRIMARY KEY,
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_ids" jsonb NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lineup_requests" (
	"user_id" text,
	"id" text,
	"intent" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lineup_requests_pkey" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "lineup_run_attempts" (
	"run_id" uuid,
	"attempt" integer,
	"lease_token" uuid NOT NULL,
	"lease_generation" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text,
	CONSTRAINT "lineup_run_attempts_pkey" PRIMARY KEY("run_id","attempt")
);
--> statement-breakpoint
CREATE TABLE "lineup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"connection_id" text NOT NULL,
	"trigger" text NOT NULL,
	"target" jsonb NOT NULL,
	"status" text NOT NULL,
	"state" jsonb NOT NULL,
	"implementation" text NOT NULL,
	"implementation_version" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_action_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lineup_team_leases" (
	"team_id" uuid PRIMARY KEY,
	"user_id" text NOT NULL,
	"run_id" uuid NOT NULL,
	"token" uuid NOT NULL,
	"generation" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lineup_write_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"run_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"user_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"connection_id" text NOT NULL,
	"connection_generation" integer NOT NULL,
	"lease_token" uuid NOT NULL,
	"lease_generation" integer NOT NULL,
	"action" text NOT NULL,
	"target" jsonb NOT NULL,
	"before" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_teams" ADD COLUMN "paused_until" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "lineup_deliveries_user_id_request_id_idx" ON "lineup_deliveries" ("user_id","request_id");--> statement-breakpoint
CREATE INDEX "lineup_deliveries_status_created_at_idx" ON "lineup_deliveries" ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lineup_runs_id_idx" ON "lineup_runs" ("id");--> statement-breakpoint
CREATE INDEX "lineup_runs_user_id_request_id_idx" ON "lineup_runs" ("user_id","request_id");--> statement-breakpoint
CREATE INDEX "lineup_runs_user_id_team_id_created_at_idx" ON "lineup_runs" ("user_id","team_id","created_at");--> statement-breakpoint
CREATE INDEX "lineup_runs_user_id_created_at_idx" ON "lineup_runs" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "lineup_runs_status_updated_at_idx" ON "lineup_runs" ("status","updated_at");--> statement-breakpoint
CREATE INDEX "lineup_runs_status_next_action_at_idx" ON "lineup_runs" ("status","next_action_at");--> statement-breakpoint
CREATE INDEX "lineup_team_leases_user_id_team_id_idx" ON "lineup_team_leases" ("user_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lineup_write_intents_run_id_attempt_idx" ON "lineup_write_intents" ("run_id","attempt");--> statement-breakpoint
CREATE INDEX "lineup_write_intents_user_id_team_id_status_idx" ON "lineup_write_intents" ("user_id","team_id","status");