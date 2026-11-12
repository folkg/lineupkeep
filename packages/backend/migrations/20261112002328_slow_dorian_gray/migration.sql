DROP INDEX "lineup_runs_one_scheduled_pending_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "lineup_runs_one_running_idx" ON "lineup_runs" ("team_id") WHERE "status" in ('reading', 'planning', 'validating', 'applying', 'verifying');--> statement-breakpoint
CREATE UNIQUE INDEX "lineup_runs_one_queued_idx" ON "lineup_runs" ("team_id","target") WHERE "status" = 'queued';