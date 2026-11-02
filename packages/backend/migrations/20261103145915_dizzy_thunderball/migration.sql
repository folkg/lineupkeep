CREATE TABLE "account_exports" (
	"user_id" text PRIMARY KEY,
	"taken_at" timestamp with time zone NOT NULL,
	"contents" jsonb NOT NULL
);
