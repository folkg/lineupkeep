ALTER TABLE "provider_teams" ADD COLUMN "unavailable_reason" text;--> statement-breakpoint
ALTER TABLE "provider_teams" ADD COLUMN "unavailable_detail" text;--> statement-breakpoint
ALTER TABLE "provider_teams" ADD COLUMN "availability_observed_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "provider_teams" AS t
SET "unavailable_reason" = 'connection_unavailable',
    "unavailable_detail" = 'The connection is not signed in, so Lineupkeep cannot read this team.',
    "availability_observed_at" = t."updated_at"
FROM "provider_connections" AS c
WHERE c."id" = t."connection_id"
  AND t."availability" = 'unavailable'
  AND c."status" <> 'ready';
--> statement-breakpoint
UPDATE "provider_teams" AS t
SET "unavailable_reason" = 'not_listed',
    "unavailable_detail" = 'The provider no longer lists this team through its connection.',
    "availability_observed_at" = t."updated_at"
FROM "provider_connections" AS c
WHERE c."id" = t."connection_id"
  AND t."availability" = 'unavailable'
  AND c."status" = 'ready';
