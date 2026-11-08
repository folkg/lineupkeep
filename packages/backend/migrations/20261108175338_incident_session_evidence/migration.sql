ALTER TABLE "connection_incidents" ADD COLUMN "operation" text;--> statement-breakpoint
ALTER TABLE "connection_incidents" ADD COLUMN "provider_status" integer;--> statement-breakpoint
ALTER TABLE "connection_incidents" ADD COLUMN "provider_detail" text;