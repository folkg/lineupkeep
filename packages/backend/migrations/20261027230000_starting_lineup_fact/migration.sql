UPDATE "lineup_runs"
SET
  "state" = jsonb_set(
    "state",
    '{observation,players}',
    (
      SELECT
        jsonb_agg(
          (players.entry - 'confirmedStart') || jsonb_build_object(
            'startingLineup',
            CASE
              WHEN players.entry->>'confirmedStart' = 'true' THEN 'confirmed-starting'
              ELSE 'unconfirmed'
            END
          )
          ORDER BY players.ordinal
        )
      FROM
        jsonb_array_elements("state"->'observation'->'players') WITH ORDINALITY AS players(entry, ordinal)
    )
  )
WHERE
  jsonb_typeof("state"->'observation'->'players') = 'array';
--> statement-breakpoint
UPDATE "lineup_run_diagnostics"
SET
  "data" = jsonb_set(
    "data",
    '{players}',
    (
      SELECT
        jsonb_agg(
          (players.entry - 'confirmedStart') || jsonb_build_object(
            'startingLineup',
            CASE
              WHEN players.entry->>'confirmedStart' = 'true' THEN 'confirmed-starting'
              ELSE 'unconfirmed'
            END
          )
          ORDER BY players.ordinal
        )
      FROM
        jsonb_array_elements("data"->'players') WITH ORDINALITY AS players(entry, ordinal)
    )
  )
WHERE
  "kind" = 'observation'
  AND jsonb_typeof("data"->'players') = 'array';
--> statement-breakpoint
UPDATE "lineup_write_intents"
SET
  "before" = (
    SELECT
      jsonb_agg(
        (players.entry - 'confirmedStart') || jsonb_build_object(
          'startingLineup',
          CASE
            WHEN players.entry->>'confirmedStart' = 'true' THEN 'confirmed-starting'
            ELSE 'unconfirmed'
          END
        )
        ORDER BY players.ordinal
      )
    FROM
      jsonb_array_elements("before") WITH ORDINALITY AS players(entry, ordinal)
  )
WHERE
  jsonb_typeof("before") = 'array'
  AND jsonb_path_exists("before", '$[*].confirmedStart');
