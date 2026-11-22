update "feedback"
set
  "resolution_note" = null,
  "updated_at" = now()
where "status" not in ('resolved', 'wontfix')
  and "resolution_note" is not null;
