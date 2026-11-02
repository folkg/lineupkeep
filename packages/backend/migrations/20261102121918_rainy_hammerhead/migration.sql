ALTER TABLE "observed_facts" RENAME TO "schedule_observations";--> statement-breakpoint
ALTER TABLE "schedule_observations" RENAME COLUMN "fact_kind" TO "observation_kind";--> statement-breakpoint
ALTER INDEX "observed_facts_observation_idx" RENAME TO "schedule_observations_observation_idx";--> statement-breakpoint
ALTER INDEX "observed_facts_subject_window_idx" RENAME TO "schedule_observations_subject_window_idx";--> statement-breakpoint
ALTER INDEX "observed_facts_expiry_idx" RENAME TO "schedule_observations_expiry_idx";