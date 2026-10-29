DELETE FROM "provider_connections"
WHERE "id" IN (
  SELECT "connection_id"
  FROM "hosted_linking_sessions"
  WHERE "status" <> 'completed'
    AND "connection_id" IS NOT NULL
)
AND "id" NOT IN (
  SELECT "connection_id"
  FROM "hosted_linking_sessions"
  WHERE "status" = 'completed'
    AND "connection_id" IS NOT NULL
);
--> statement-breakpoint
UPDATE "hosted_linking_sessions"
SET "connection_id" = NULL
WHERE "status" <> 'completed';
--> statement-breakpoint
ALTER TABLE "hosted_linking_sessions" ALTER COLUMN "connection_id" DROP NOT NULL;
