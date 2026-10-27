UPDATE "lineup_runs"
SET "state" = jsonb_set("state", '{plan,_tag}', '"native_action"')
WHERE "state"->'plan'->>'_tag' = 'start_active_players';
--> statement-breakpoint
UPDATE "lineup_write_intents"
SET "plan" = jsonb_set("plan", '{_tag}', '"native_action"')
WHERE "plan"->>'_tag' = 'start_active_players';
--> statement-breakpoint
UPDATE "lineup_write_intents"
SET "action" = 'native_action'
WHERE "action" = 'start_active_players';
--> statement-breakpoint
UPDATE "lineup_runs"
SET "state" = jsonb_set(
  "state",
  '{observation}',
  (
    (("state"->'observation')::jsonb
      - 'leagueCurrentWeek'::text
      - 'leagueStartWeek'::text
      - 'leagueEndWeek'::text)
  ) || jsonb_strip_nulls(jsonb_build_object(
    'leagueCurrentPeriod', "state"->'observation'->'leagueCurrentWeek',
    'leagueStartPeriod', "state"->'observation'->'leagueStartWeek',
    'leagueEndPeriod', "state"->'observation'->'leagueEndWeek'
  ))
)
WHERE ("state"->'observation') ?| array['leagueCurrentWeek', 'leagueStartWeek', 'leagueEndWeek'];
