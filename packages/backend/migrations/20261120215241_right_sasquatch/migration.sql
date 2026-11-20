DROP INDEX "transaction_moves_timeline_idx";--> statement-breakpoint
CREATE INDEX "transaction_moves_timeline_idx" ON "transaction_moves" ("user_id","run_day","team_id","position") WHERE (("decision" <> 'discarded') and (("phase" is null)) and (((("result" is null)) or ("result" <> 'executed'))));--> statement-breakpoint
DROP INDEX "transaction_moves_due_idx";--> statement-breakpoint
CREATE INDEX "transaction_moves_due_idx" ON "transaction_moves" ("run_day","decision") WHERE (("decision" <> 'discarded') and (("phase" is null)) and (((("result" is null)) or ("result" <> 'executed'))));