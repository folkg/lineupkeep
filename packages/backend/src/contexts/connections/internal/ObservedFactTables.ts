import { createSelectSchema } from "drizzle-orm/effect-schema";
import {
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { Schema } from "effect";

import { FantasySport, fantasySports } from "#contexts/connections/FantasyTeam.ts";
import { ProviderKey } from "#contexts/connections/ProviderKey.ts";

import {
  observedFactConfidences,
  observedFactKinds,
  observedFactSubjectKinds,
} from "./ObservedFacts.ts";

export const observedFacts = pgTable(
  "observed_facts",
  {
    source: text("source").notNull(),
    subjectKind: text("subject_kind", { enum: observedFactSubjectKinds }).notNull(),
    subjectKey: text("subject_key").notNull(),
    factKind: text("fact_kind", { enum: observedFactKinds }).notNull(),
    coversFrom: date("covers_from").notNull(),
    coversTo: date("covers_to").notNull(),
    value: jsonb("value").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    confidence: text("confidence", { enum: observedFactConfidences }).notNull(),
    sourceReference: text("source_reference").notNull(),
  },
  (table) => [
    uniqueIndex("observed_facts_observation_idx").on(
      table.source,
      table.subjectKind,
      table.subjectKey,
      table.factKind,
      table.coversFrom,
      table.coversTo,
      table.observedAt,
    ),
    index("observed_facts_subject_window_idx").on(
      table.subjectKind,
      table.subjectKey,
      table.factKind,
      table.coversFrom,
      table.coversTo,
    ),
  ],
);

export const professionalTeamIdentities = pgTable(
  "professional_team_identities",
  {
    sport: text("sport", { enum: fantasySports }).notNull(),
    source: text("source").notNull(),
    sourceTeamIdentifier: text("source_team_identifier").notNull(),
    provider: text("provider").notNull(),
    providerTeamKey: text("provider_team_key").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.sport,
        table.source,
        table.sourceTeamIdentifier,
        table.provider,
        table.providerTeamKey,
      ],
    }),
    index("professional_team_identities_lookup_idx").on(table.sport, table.sourceTeamIdentifier),
  ],
);

export const ProfessionalTeamIdentityRow = createSelectSchema(professionalTeamIdentities, {
  sport: FantasySport,
  source: Schema.NonEmptyString,
  sourceTeamIdentifier: Schema.NonEmptyString,
  provider: ProviderKey,
  providerTeamKey: Schema.NonEmptyString,
  observedAt: Schema.DateTimeUtcFromDate,
});
export type ProfessionalTeamIdentityRow = typeof ProfessionalTeamIdentityRow.Type;
