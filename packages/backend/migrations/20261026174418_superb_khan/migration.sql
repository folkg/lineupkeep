ALTER TABLE "lineup_write_intents" ADD COLUMN "plan" jsonb;
--> statement-breakpoint
UPDATE "lineup_runs"
SET "state" = jsonb_set("state" #- '{plan,action}', '{plan,_tag}', '"start_active_players"')
WHERE "state"->'plan' ? 'action';
