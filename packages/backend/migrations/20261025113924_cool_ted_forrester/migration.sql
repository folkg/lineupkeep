ALTER TABLE "provider_connections" ADD COLUMN "reconnect_code" text;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "reconnect_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD COLUMN "reconnect_request_id" text;--> statement-breakpoint
ALTER TABLE "provider_teams" ADD COLUMN "automation_state" jsonb;--> statement-breakpoint
ALTER TABLE "provider_teams" ADD COLUMN "automation_status" text;--> statement-breakpoint
UPDATE "provider_teams"
SET
  "automation_state" = CASE
    WHEN "paused_until" IS NOT NULL AND "paused_until" > now()
      THEN jsonb_build_object(
        '_tag', 'PausedUntilFantasyDayEnd',
        'changedAt', to_jsonb("updated_at"),
        'pausedAt', to_jsonb("updated_at"),
        'resumesAt', to_jsonb("paused_until"),
        'timeZone', 'America/Los_Angeles',
        'fantasyDay', to_char("paused_until" AT TIME ZONE 'America/Los_Angeles', 'YYYY-MM-DD'),
        'policyVersion', 'yahoo-pacific-midnight/1'
      )
    WHEN "automation_enabled"
      THEN jsonb_build_object('_tag', 'Enabled', 'changedAt', to_jsonb("updated_at"))
    ELSE jsonb_build_object('_tag', 'Disabled', 'changedAt', to_jsonb("updated_at"))
  END,
  "automation_status" = CASE
    WHEN "paused_until" IS NOT NULL AND "paused_until" > now()
      THEN 'paused-until-fantasy-day-end'
    WHEN "automation_enabled" THEN 'enabled'
    ELSE 'disabled'
  END;--> statement-breakpoint
ALTER TABLE "provider_teams" ALTER COLUMN "automation_state" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_teams" ALTER COLUMN "automation_status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_teams" DROP COLUMN "automation_enabled";--> statement-breakpoint
ALTER TABLE "provider_teams" DROP COLUMN "paused_until";--> statement-breakpoint
CREATE INDEX "provider_connections_reconnect_code_idx" ON "provider_connections" ("reconnect_code");--> statement-breakpoint
CREATE INDEX "provider_teams_user_id_automation_status_idx" ON "provider_teams" ("user_id","automation_status");--> statement-breakpoint
CREATE INDEX "provider_teams_automation_status_availability_idx" ON "provider_teams" ("automation_status","availability");
