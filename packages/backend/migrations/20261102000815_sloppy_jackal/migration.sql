DROP INDEX "observed_facts_observation_idx";--> statement-breakpoint
DELETE FROM "observed_facts" AS "older"
USING "observed_facts" AS "newer"
WHERE "older"."source" = "newer"."source"
  AND "older"."subject_kind" = "newer"."subject_kind"
  AND "older"."subject_key" = "newer"."subject_key"
  AND "older"."fact_kind" = "newer"."fact_kind"
  AND "older"."covers_from" = "newer"."covers_from"
  AND "older"."covers_to" = "newer"."covers_to"
  AND "older"."observed_at" < "newer"."observed_at";--> statement-breakpoint
CREATE UNIQUE INDEX "observed_facts_observation_idx" ON "observed_facts" ("source","subject_kind","subject_key","fact_kind","covers_from","covers_to");--> statement-breakpoint
CREATE INDEX "observed_facts_expiry_idx" ON "observed_facts" ("covers_to");