UPDATE "lineup_runs"
SET
  "state" = jsonb_set(
    "state",
    '{plan,provenance}',
    jsonb_strip_nulls(
      jsonb_build_object(
        'kind', COALESCE("state"->'plan'->'policy'->>'kind', 'planned'),
        'label', COALESCE(
          "state"->'plan'->'policy'->>'basis',
          "state"->'plan'->'policy'->>'code',
          "state"->'plan'->'policy'->>'version'
        ),
        'detail', "state"->'plan'->'policy'->>'detail'
      )
    )
  )
WHERE
  "state"->'plan' ? 'policy';
--> statement-breakpoint
UPDATE "lineup_runs"
SET
  "state" = "state" #- '{plan,policy}'
WHERE
  "state"->'plan' ? 'policy';
--> statement-breakpoint
UPDATE "lineup_runs"
SET
  "state" = jsonb_set(
    "state",
    '{outcome,provenance}',
    jsonb_strip_nulls(
      jsonb_build_object(
        'kind', "state"->'outcome'->'policy'->>'kind',
        'label', COALESCE(
          "state"->'outcome'->'policy'->>'basis',
          "state"->'outcome'->'policy'->>'code',
          "state"->'outcome'->'policy'->>'version'
        ),
        'detail', "state"->'outcome'->'policy'->>'detail'
      )
    )
  )
WHERE
  "state"->'outcome' ? 'policy';
--> statement-breakpoint
UPDATE "lineup_runs"
SET
  "state" = "state" #- '{outcome,policy}'
WHERE
  "state"->'outcome' ? 'policy';
--> statement-breakpoint
UPDATE "lineup_write_intents"
SET
  "plan" = jsonb_set(
    "plan",
    '{provenance}',
    jsonb_strip_nulls(
      jsonb_build_object(
        'kind', COALESCE("plan"->'policy'->>'kind', 'planned'),
        'label', COALESCE(
          "plan"->'policy'->>'basis',
          "plan"->'policy'->>'code',
          "plan"->'policy'->>'version'
        ),
        'detail', "plan"->'policy'->>'detail'
      )
    )
  )
WHERE
  "plan" IS NOT NULL
  AND "plan" ? 'policy';
--> statement-breakpoint
UPDATE "lineup_write_intents"
SET
  "plan" = "plan" - 'policy'
WHERE
  "plan" IS NOT NULL
  AND "plan" ? 'policy';
--> statement-breakpoint
UPDATE "provider_teams"
SET
  "automation_state" = jsonb_set(
    "automation_state" - 'policyVersion',
    '{fantasyDayVersion}',
    "automation_state"->'policyVersion'
  )
WHERE
  "automation_state" ? 'policyVersion';
