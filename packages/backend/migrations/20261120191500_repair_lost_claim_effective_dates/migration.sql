update "transaction_moves" as "moves"
set
  "effective_date" = to_char(("moves"."run_day"::date + 1), 'YYYY-MM-DD'),
  "attempts" = (
    select jsonb_agg(
      case
        when "entry"."attempt"->>'kind' = 'fallback'
          and "entry"."attempt"->>'outcome' = 'executed'
        then jsonb_set(
          "entry"."attempt",
          '{effectiveDate}',
          to_jsonb(to_char(("moves"."run_day"::date + 1), 'YYYY-MM-DD'))
        )
        else "entry"."attempt"
      end
      order by "entry"."position"
    )
    from jsonb_array_elements("moves"."attempts") with ordinality as "entry"("attempt", "position")
  )
where "moves"."phase" = 'lost'
  and "moves"."result" = 'executed'
  and "moves"."effective_date" < "moves"."run_day"
  and jsonb_array_length("moves"."attempts") > 0;
