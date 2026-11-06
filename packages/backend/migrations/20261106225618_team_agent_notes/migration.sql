CREATE TABLE "provider_team_agent_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"team_id" uuid NOT NULL,
	"connection_id" text NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"author_name" text,
	"author_client_id" text NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "provider_teams_id_idx";--> statement-breakpoint
ALTER TABLE "provider_teams" ADD CONSTRAINT "provider_teams_id_unique" UNIQUE("id");--> statement-breakpoint
CREATE INDEX "provider_team_agent_notes_team_written_at_idx" ON "provider_team_agent_notes" ("team_id","written_at");--> statement-breakpoint
CREATE INDEX "provider_team_agent_notes_user_id_team_id_idx" ON "provider_team_agent_notes" ("user_id","team_id");--> statement-breakpoint
ALTER TABLE "provider_team_agent_notes" ADD CONSTRAINT "provider_team_agent_notes_team_id_provider_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "provider_teams"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_team_agent_notes" ADD CONSTRAINT "provider_team_agent_notes_8tmTQeJ6WNO0_fkey" FOREIGN KEY ("connection_id") REFERENCES "provider_connections"("id") ON DELETE CASCADE;