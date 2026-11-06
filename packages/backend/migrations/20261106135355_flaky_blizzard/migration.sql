ALTER TABLE "transaction_proposal_items" ADD COLUMN "reserve_move" jsonb;--> statement-breakpoint
ALTER TABLE "transaction_proposal_sets" ADD COLUMN "orders" jsonb;