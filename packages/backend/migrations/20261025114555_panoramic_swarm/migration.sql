CREATE TABLE "lineup_run_diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"run_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"user_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "lineup_run_diagnostics_run_id_idx" ON "lineup_run_diagnostics" ("run_id");--> statement-breakpoint
CREATE INDEX "lineup_run_diagnostics_expires_at_idx" ON "lineup_run_diagnostics" ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lineup_runs_one_scheduled_pending_idx" ON "lineup_runs" ("team_id") WHERE "trigger" = 'scheduled' and "status" in ('queued', 'reading', 'planning', 'validating', 'applying', 'verifying', 'retry-wait', 'uncertain');