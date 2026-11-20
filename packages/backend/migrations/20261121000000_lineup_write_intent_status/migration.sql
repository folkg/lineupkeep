WITH "remapped" AS (
  UPDATE "lineup_write_intents"
  SET "status" = 'unknown'
  WHERE "status" = 'sent'
  RETURNING "id"
)
UPDATE "lineup_runs" AS "runs"
SET "state" = jsonb_set("runs"."state", '{writeIntent,status}', to_jsonb(
  CASE WHEN "intents"."status" = 'sent' THEN 'unknown' ELSE "intents"."status" END
))
FROM "lineup_write_intents" AS "intents"
WHERE "intents"."run_id" = "runs"."id"
  AND "intents"."id" = "runs"."state"->'writeIntent'->>'id'
  AND "runs"."state" ? 'writeIntent'
  AND NOT ("runs"."state"->'writeIntent' ? 'status');
