CREATE TABLE "transaction_move_claims" (
	"user_id" text NOT NULL,
	"team_id" text NOT NULL,
	"claim_kind" text NOT NULL,
	"claim_key" text NOT NULL,
	"move_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_move_steps" (
	"id" text PRIMARY KEY,
	"move_id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"player_key" text NOT NULL,
	"from_slot" text,
	"to_slot" text,
	"outcome" text NOT NULL,
	"detail" text,
	"decided_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_moves" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"team_id" text NOT NULL,
	"group_id" text,
	"position" integer NOT NULL,
	"run_position" integer,
	"kind" text NOT NULL,
	"adds" jsonb NOT NULL,
	"fallbacks" jsonb NOT NULL,
	"drops" jsonb NOT NULL,
	"picks" jsonb NOT NULL,
	"slot_move" jsonb,
	"intent" jsonb,
	"placement" jsonb,
	"counterparty_key" text,
	"external_ref" text,
	"bid" integer,
	"reason" text NOT NULL,
	"run_day" text,
	"effective_date" text,
	"decision" text NOT NULL,
	"decided_at" timestamp with time zone,
	"validation" text NOT NULL,
	"checked_at" timestamp with time zone,
	"validation_reasons" jsonb NOT NULL,
	"result" text,
	"result_detail" text,
	"result_at" timestamp with time zone,
	"proposed_by" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_plans" (
	"user_id" text,
	"team_id" text,
	"run_claim" text,
	"run_claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_plans_pkey" PRIMARY KEY("user_id","team_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_move_claims_owner_claim_idx" ON "transaction_move_claims" ("user_id","team_id","claim_kind","claim_key");--> statement-breakpoint
CREATE INDEX "transaction_move_claims_move_id_idx" ON "transaction_move_claims" ("move_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_move_steps_move_id_position_idx" ON "transaction_move_steps" ("move_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_moves_user_id_team_id_position_idx" ON "transaction_moves" ("user_id","team_id","position");--> statement-breakpoint
CREATE INDEX "transaction_moves_timeline_idx" ON "transaction_moves" ("user_id","run_day","team_id","position") WHERE (("decision" <> 'discarded') and (((("result" is null)) or ((("result" <> 'executed') and ("result" <> 'withdrawn') and ("result" <> 'expired'))))));--> statement-breakpoint
CREATE INDEX "transaction_moves_due_idx" ON "transaction_moves" ("run_day","decision") WHERE (("decision" <> 'discarded') and (((("result" is null)) or ((("result" <> 'executed') and ("result" <> 'withdrawn') and ("result" <> 'expired'))))));--> statement-breakpoint
ALTER TABLE "transaction_move_claims" ADD CONSTRAINT "transaction_move_claims_move_id_transaction_moves_id_fkey" FOREIGN KEY ("move_id") REFERENCES "transaction_moves"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transaction_move_steps" ADD CONSTRAINT "transaction_move_steps_move_id_transaction_moves_id_fkey" FOREIGN KEY ("move_id") REFERENCES "transaction_moves"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transaction_moves" ADD CONSTRAINT "transaction_moves_joj5eikA4kLl_fkey" FOREIGN KEY ("user_id","team_id") REFERENCES "transaction_plans"("user_id","team_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transaction_plans" ADD CONSTRAINT "transaction_plans_team_id_provider_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "provider_teams"("id") ON DELETE CASCADE;