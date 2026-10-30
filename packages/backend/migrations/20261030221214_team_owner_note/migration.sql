ALTER TABLE "provider_teams" ADD COLUMN "owner_note" text;
--> statement-breakpoint
ALTER TABLE "provider_teams" ADD COLUMN "owner_note_updated_at" timestamp with time zone;
