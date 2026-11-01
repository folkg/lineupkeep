CREATE TABLE "observed_facts" (
	"source" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_key" text NOT NULL,
	"fact_kind" text NOT NULL,
	"covers_from" date NOT NULL,
	"covers_to" date NOT NULL,
	"value" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"confidence" text NOT NULL,
	"source_reference" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "observed_facts_observation_idx" ON "observed_facts" ("source","subject_kind","subject_key","fact_kind","covers_from","covers_to","observed_at");--> statement-breakpoint
CREATE INDEX "observed_facts_subject_window_idx" ON "observed_facts" ("subject_kind","subject_key","fact_kind","covers_from","covers_to");