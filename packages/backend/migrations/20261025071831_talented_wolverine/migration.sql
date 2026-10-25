CREATE TABLE "provider_teams" (
	"connection_id" text,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_team_key" text,
	"provider_league_key" text NOT NULL,
	"league" text NOT NULL,
	"sport" text NOT NULL,
	"season" integer NOT NULL,
	"name" text NOT NULL,
	"availability" text DEFAULT 'available' NOT NULL,
	"automation_enabled" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_teams_pkey" PRIMARY KEY("connection_id","provider_team_key")
);
--> statement-breakpoint
CREATE INDEX "provider_teams_user_id_league_name_idx" ON "provider_teams" ("user_id","league","name");