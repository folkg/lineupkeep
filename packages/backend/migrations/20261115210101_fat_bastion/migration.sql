CREATE TABLE "transaction_runs" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"team_id" text NOT NULL,
	"trigger" text NOT NULL,
	"key" text,
	"at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"counts" jsonb NOT NULL,
	"refusals" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transaction_moves" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transaction_moves" ADD COLUMN "confirmed_by" text;--> statement-breakpoint
ALTER TABLE "transaction_moves" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "transaction_moves" ADD COLUMN "run_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_runs_owner_key_idx" ON "transaction_runs" ("user_id","team_id","key") WHERE ("key" is not null);--> statement-breakpoint
CREATE INDEX "transaction_runs_team_at_idx" ON "transaction_runs" ("user_id","team_id","at");--> statement-breakpoint
ALTER TABLE "transaction_runs" ADD CONSTRAINT "transaction_runs_IKpVY5UrxFHf_fkey" FOREIGN KEY ("user_id","team_id") REFERENCES "transaction_plans"("user_id","team_id") ON DELETE CASCADE;