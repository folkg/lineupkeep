ALTER TABLE "transaction_proposal_items" ADD COLUMN "connection_id" text;--> statement-breakpoint
UPDATE "transaction_proposal_items"
SET "connection_id" = "provider_teams"."connection_id"
FROM "provider_teams"
WHERE "provider_teams"."id" = "transaction_proposal_items"."team_id";--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ALTER COLUMN "connection_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ADD COLUMN "counterparty_team_key" text;--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ADD COLUMN "counterparty_name" text;--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ADD COLUMN "trade_provider_key" text;--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ADD COLUMN "trade_state" text;--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ADD COLUMN "trade_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ADD COLUMN "trade_proposed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ADD COLUMN "trade_settled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ADD COLUMN "trade_detail" text;