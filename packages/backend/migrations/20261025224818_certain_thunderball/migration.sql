CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"submitter_kind" text NOT NULL,
	"submitter_reference" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"tool_name" text,
	"team_reference" text,
	"client_name" text,
	"surface" text,
	"resolution_note" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback_quota" (
	"key" text PRIMARY KEY,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "feedback_user_id_status_created_at_idx" ON "feedback" ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "feedback_user_id_kind_created_at_idx" ON "feedback" ("user_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "feedback_user_id_created_at_idx" ON "feedback" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_status_closed_at_idx" ON "feedback" ("status","closed_at");--> statement-breakpoint
CREATE INDEX "feedback_quota_window_started_at_idx" ON "feedback_quota" ("window_started_at");