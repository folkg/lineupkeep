ALTER TABLE "provider_team_agent_notes" DROP CONSTRAINT "provider_team_agent_notes_team_id_provider_teams_id_fkey";--> statement-breakpoint
ALTER TABLE "provider_teams" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "provider_teams" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "lineup_deliveries" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "lineup_run_attempts" ALTER COLUMN "run_id" SET DATA TYPE text USING "run_id"::text;--> statement-breakpoint
ALTER TABLE "lineup_run_attempts" ALTER COLUMN "lease_token" SET DATA TYPE text USING "lease_token"::text;--> statement-breakpoint
ALTER TABLE "lineup_runs" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "lineup_runs" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "lineup_runs" ALTER COLUMN "team_id" SET DATA TYPE text USING "team_id"::text;--> statement-breakpoint
ALTER TABLE "lineup_team_leases" ALTER COLUMN "team_id" SET DATA TYPE text USING "team_id"::text;--> statement-breakpoint
ALTER TABLE "lineup_team_leases" ALTER COLUMN "run_id" SET DATA TYPE text USING "run_id"::text;--> statement-breakpoint
ALTER TABLE "lineup_team_leases" ALTER COLUMN "token" SET DATA TYPE text USING "token"::text;--> statement-breakpoint
ALTER TABLE "lineup_write_intents" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "lineup_write_intents" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "lineup_write_intents" ALTER COLUMN "run_id" SET DATA TYPE text USING "run_id"::text;--> statement-breakpoint
ALTER TABLE "lineup_write_intents" ALTER COLUMN "team_id" SET DATA TYPE text USING "team_id"::text;--> statement-breakpoint
ALTER TABLE "lineup_write_intents" ALTER COLUMN "lease_token" SET DATA TYPE text USING "lease_token"::text;--> statement-breakpoint
ALTER TABLE "lineup_run_diagnostics" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "lineup_run_diagnostics" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "lineup_run_diagnostics" ALTER COLUMN "run_id" SET DATA TYPE text USING "run_id"::text;--> statement-breakpoint
ALTER TABLE "lineup_run_diagnostics" ALTER COLUMN "team_id" SET DATA TYPE text USING "team_id"::text;--> statement-breakpoint
ALTER TABLE "connection_incidents" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "connection_incidents" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "incident_id" SET DATA TYPE text USING "incident_id"::text;--> statement-breakpoint
ALTER TABLE "feedback" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "feedback" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ALTER COLUMN "set_id" SET DATA TYPE text USING "set_id"::text;--> statement-breakpoint
ALTER TABLE "transaction_proposal_items" ALTER COLUMN "team_id" SET DATA TYPE text USING "team_id"::text;--> statement-breakpoint
ALTER TABLE "transaction_proposal_sets" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "transaction_proposal_sets" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transaction_proposal_steps" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "transaction_proposal_steps" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transaction_proposal_steps" ALTER COLUMN "set_id" SET DATA TYPE text USING "set_id"::text;--> statement-breakpoint
ALTER TABLE "transaction_proposal_steps" ALTER COLUMN "item_id" SET DATA TYPE text USING "item_id"::text;--> statement-breakpoint
ALTER TABLE "provider_team_agent_notes" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "provider_team_agent_notes" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "provider_team_agent_notes" ALTER COLUMN "team_id" SET DATA TYPE text USING "team_id"::text;--> statement-breakpoint
ALTER TABLE "transaction_proposal_submissions" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "transaction_proposal_submissions" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "transaction_proposal_submissions" ALTER COLUMN "set_id" SET DATA TYPE text USING "set_id"::text;--> statement-breakpoint
ALTER TABLE "provider_team_agent_notes" ADD CONSTRAINT "provider_team_agent_notes_team_id_provider_teams_id_fkey" FOREIGN KEY ("team_id") REFERENCES "provider_teams"("id") ON DELETE CASCADE;
