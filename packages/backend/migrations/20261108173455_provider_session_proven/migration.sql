ALTER TABLE "provider_credentials" ADD COLUMN "proven_at" timestamp with time zone;--> statement-breakpoint
UPDATE "provider_credentials" SET "proven_at" = "created_at" WHERE "proven_at" IS NULL;--> statement-breakpoint
ALTER TABLE "provider_credentials" ALTER COLUMN "proven_at" SET NOT NULL;
