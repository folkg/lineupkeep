CREATE TABLE "hosted_linking_session_locks" (
	"user_id" text PRIMARY KEY,
	"session_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hosted_linking_sessions" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"ticket_hash" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "hosted_linking_sessions_user_created_idx" ON "hosted_linking_sessions" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "hosted_linking_sessions_expiry_idx" ON "hosted_linking_sessions" ("status","expires_at");