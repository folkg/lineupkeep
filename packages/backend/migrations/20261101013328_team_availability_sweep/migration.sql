ALTER TABLE "provider_teams" ADD COLUMN "availability_refusals" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "provider_teams"
SET "availability_refusals" = 1
WHERE "availability" = 'unavailable'
  AND "unavailable_reason" = 'provider_refused';