CREATE TABLE "transaction_proposal_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"set_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"user_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"add_players" jsonb NOT NULL,
	"drop_players" jsonb NOT NULL,
	"bid" integer,
	"reason" text NOT NULL,
	"state" text NOT NULL,
	"staleness" text NOT NULL,
	"stale_reasons" jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_proposal_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"proposer_kind" text NOT NULL,
	"proposer_reference" text NOT NULL,
	"surface" text NOT NULL,
	"client_label" text,
	"fingerprint" text NOT NULL,
	"teams" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_proposal_items_set_id_position_idx" ON "transaction_proposal_items" ("set_id","position");--> statement-breakpoint
CREATE INDEX "transaction_proposal_items_user_id_team_id_state_idx" ON "transaction_proposal_items" ("user_id","team_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_proposal_sets_user_id_fingerprint_idx" ON "transaction_proposal_sets" ("user_id","fingerprint");--> statement-breakpoint
CREATE INDEX "transaction_proposal_sets_user_id_created_at_idx" ON "transaction_proposal_sets" ("user_id","created_at");