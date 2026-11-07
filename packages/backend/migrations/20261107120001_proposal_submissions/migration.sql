CREATE TABLE "transaction_proposal_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"set_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ADD COLUMN "settled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "transaction_proposal_items"
SET "settled" = true
WHERE "state" IN ('executed', 'accepted', 'withdrawn', 'expired');--> statement-breakpoint
INSERT INTO "transaction_proposal_submissions"
	("set_id", "user_id", "ordinal", "submitted_at", "completed_at")
SELECT "id", COALESCE("submitted_by_user_id", "user_id"), 1, "submitted_at", "completed_at"
FROM "transaction_proposal_sets"
WHERE "submitted_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_proposal_sets" DROP COLUMN "submitted_by_user_id";--> statement-breakpoint
ALTER TABLE "transaction_proposal_sets" DROP COLUMN "submitted_at";--> statement-breakpoint
ALTER TABLE "transaction_proposal_sets" DROP COLUMN "completed_at";--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_proposal_submissions_set_id_ordinal_idx" ON "transaction_proposal_submissions" ("set_id","ordinal");--> statement-breakpoint
CREATE INDEX "transaction_proposal_submissions_user_id_set_id_idx" ON "transaction_proposal_submissions" ("user_id","set_id");
