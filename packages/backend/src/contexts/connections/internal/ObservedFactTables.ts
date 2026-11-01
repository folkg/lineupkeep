import { createSelectSchema } from "drizzle-orm/effect-schema";
import { date, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { Schema } from "effect";

import { ProviderKey } from "#contexts/connections/Connection.ts";

import {
  observedFactConfidences,
  observedFactKinds,
  observedFactSubjectKinds,
  providerOpponentValue,
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

export const ProviderOpponentFactRow = createSelectSchema(observedFacts, {
  source: ProviderKey,
  subjectKind: Schema.Literals(observedFactSubjectKinds),
  subjectKey: Schema.NonEmptyString,
  factKind: Schema.Literals(observedFactKinds),
  coversFrom: Schema.NonEmptyString,
  coversTo: Schema.NonEmptyString,
  value: providerOpponentValue,
  observedAt: Schema.DateTimeUtcFromDate,
  confidence: Schema.Literals(observedFactConfidences),
  sourceReference: Schema.NonEmptyString,
});
export type ProviderOpponentFactRow = typeof ProviderOpponentFactRow.Type;
