ALTER TABLE "transaction_proposal_items" ADD COLUMN "intent" jsonb;--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ADD COLUMN "placement" jsonb;--> statement-breakpoint
ALTER TABLE "transaction_proposal_sets" ADD COLUMN "lineups" jsonb;