CREATE TABLE "professional_team_identities" (
	"sport" text,
	"source" text,
	"source_team_identifier" text,
	"provider" text,
	"provider_team_key" text,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "professional_team_identities_pkey" PRIMARY KEY("sport","source","source_team_identifier","provider","provider_team_key")
);
--> statement-breakpoint
CREATE INDEX "professional_team_identities_lookup_idx" ON "professional_team_identities" ("sport","source_team_identifier");