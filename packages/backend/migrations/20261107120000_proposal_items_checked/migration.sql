UPDATE "transaction_proposal_items"
SET "staleness" = 'stale',
	"checked_at" = "updated_at",
	"stale_reasons" = '[{"code":"state_unavailable","detail":"This move has not been checked against current state since it was stored, so it is excluded until the set is revalidated."}]'::jsonb
WHERE "staleness" = 'unchecked';
