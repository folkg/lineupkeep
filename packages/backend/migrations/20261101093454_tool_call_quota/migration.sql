CREATE TABLE "tool_call_quota" (
	"key" text PRIMARY KEY,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
