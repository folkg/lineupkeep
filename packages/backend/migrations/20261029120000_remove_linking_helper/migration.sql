DROP INDEX IF EXISTS "provider_connections_reconnect_code_idx";
--> statement-breakpoint
ALTER TABLE "provider_connections" DROP COLUMN "pairing_code";
--> statement-breakpoint
ALTER TABLE "provider_connections" DROP COLUMN "reconnect_code";
--> statement-breakpoint
ALTER TABLE "provider_connections" DROP COLUMN "reconnect_expires_at";
--> statement-breakpoint
ALTER TABLE "provider_connections" DROP COLUMN "reconnect_request_id";
--> statement-breakpoint
DROP TABLE IF EXISTS "device_code";
--> statement-breakpoint
DELETE FROM "oauth_access_token" WHERE "client_id" = 'lineupkeep-linking-helper';
--> statement-breakpoint
DELETE FROM "oauth_refresh_token" WHERE "client_id" = 'lineupkeep-linking-helper';
--> statement-breakpoint
DELETE FROM "oauth_consent" WHERE "client_id" = 'lineupkeep-linking-helper';
--> statement-breakpoint
DELETE FROM "oauth_client_resource" WHERE "client_id" = 'lineupkeep-linking-helper';
--> statement-breakpoint
DELETE FROM "oauth_client" WHERE "client_id" = 'lineupkeep-linking-helper';
