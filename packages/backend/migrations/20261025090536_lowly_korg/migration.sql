ALTER TABLE "provider_teams" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_teams_id_idx" ON "provider_teams" ("id");