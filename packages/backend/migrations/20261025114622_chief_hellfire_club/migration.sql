ALTER TABLE "lineup_runs" ADD COLUMN "schedule_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "lineup_runs_team_schedule_key_idx" ON "lineup_runs" ("team_id","schedule_key");