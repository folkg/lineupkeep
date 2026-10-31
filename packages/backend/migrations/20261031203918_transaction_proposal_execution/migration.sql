CREATE TABLE "transaction_proposal_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"set_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"player_key" text NOT NULL,
	"player_name" text,
	"from_slot" text,
	"to_slot" text,
	"outcome" text NOT NULL,
	"detail" text,
	"decided_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ADD COLUMN "outcome_detail" text;--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ADD COLUMN "outcome_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transaction_proposal_sets" ADD COLUMN "submitted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "transaction_proposal_sets" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transaction_proposal_sets" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_proposal_steps_item_id_position_idx" ON "transaction_proposal_steps" ("item_id","position");--> statement-breakpoint
CREATE INDEX "transaction_proposal_steps_user_id_set_id_idx" ON "transaction_proposal_steps" ("user_id","set_id");