ALTER TABLE "transaction_moves" ADD COLUMN "decided_by" text;--> statement-breakpoint
ALTER TABLE "transaction_moves" ADD COLUMN "decided_surface" text;--> statement-breakpoint
ALTER TABLE "transaction_moves" ADD COLUMN "run_decided_by" text;--> statement-breakpoint
ALTER TABLE "transaction_moves" ADD COLUMN "run_decided_surface" text;--> statement-breakpoint
ALTER TABLE "transaction_runs" ADD COLUMN "decided_by" text;--> statement-breakpoint
ALTER TABLE "transaction_runs" ADD COLUMN "decided_surface" text;