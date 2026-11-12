update "provider_connections"
set "approved_at" = "updated_at"
where "status" = 'ready' and "approved_at" is null;
