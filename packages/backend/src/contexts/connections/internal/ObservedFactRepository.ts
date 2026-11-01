import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import type { ProviderKey } from "#contexts/connections/Connection.ts";
import type { TeamId } from "#contexts/connections/FantasyTeam.ts";
import { QueryPersistenceFailed } from "#contexts/connections/QueryValues.ts";
import { maxInsertRows } from "#database/dbUtilities.ts";
import { chunked } from "#utilities/collections.ts";

import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import type { FactWindow, ObservedFactConfidence, ProviderOpponentValue } from "./ObservedFacts.ts";
import { observedFacts, ProviderOpponentFactRow } from "./ObservedFactTables.ts";

export type ProviderOpponentObservation = {
  readonly source: ProviderKey;
  readonly window: FactWindow;
  readonly value: ProviderOpponentValue;
  readonly observedAt: DateTime.Utc;
  readonly sourceReference: string;
};

export type ProviderOpponentObservationWrite = Omit<ProviderOpponentObservation, "source">;

export class ObservedFactRepository extends Context.Service<ObservedFactRepository>()(
  "@lineupkeep/backend/contexts/connections/internal/ObservedFactRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;

      const readProviderOpponents = Effect.fn("ObservedFactRepository.readProviderOpponents")(
        function* (input: {
          readonly subjectKey: TeamId;
          readonly from: string;
          readonly to: string;
        }) {
          const rows = yield* database
            .select()
            .from(observedFacts)
            .where(
              and(
                eq(observedFacts.subjectKind, "fantasy_team"),
                eq(observedFacts.subjectKey, input.subjectKey),
                eq(observedFacts.factKind, "provider_opponent"),
                eq(observedFacts.coversFrom, observedFacts.coversTo),
                gte(observedFacts.coversFrom, input.from),
                lte(observedFacts.coversFrom, input.to),
              ),
            )
            .orderBy(desc(observedFacts.observedAt))
            .pipe(Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })));
          return yield* Effect.forEach(rows, (row) =>
            Schema.decodeUnknownEffect(ProviderOpponentFactRow)(row).pipe(
              Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
              Effect.map((decoded): ProviderOpponentObservation => ({
                source: decoded.source,
                window: { from: decoded.coversFrom, to: decoded.coversTo },
                value: decoded.value,
                observedAt: decoded.observedAt,
                sourceReference: decoded.sourceReference,
              })),
            ),
          );
        },
      );

      const recordProviderOpponents = Effect.fn("ObservedFactRepository.recordProviderOpponents")(
        function* (input: {
          readonly subjectKey: TeamId;
          readonly source: ProviderKey;
          readonly confidence: ObservedFactConfidence;
          readonly observations: ReadonlyArray<ProviderOpponentObservationWrite>;
        }) {
          if (input.observations.length === 0) {
            return;
          }
          const rows = input.observations
            .map((observation) => ({
              source: input.source,
              subjectKind: "fantasy_team" as const,
              subjectKey: input.subjectKey,
              factKind: "provider_opponent" as const,
              coversFrom: observation.window.from,
              coversTo: observation.window.to,
              value: observation.value,
              observedAt: DateTime.toDateUtc(observation.observedAt),
              confidence: input.confidence,
              sourceReference: observation.sourceReference,
            }))
            .toSorted((left, right) => observationKey(left).localeCompare(observationKey(right)));
          yield* chunked(rows, maxInsertRows(observedFacts), (chunk) =>
            database
              .insert(observedFacts)
              .values([...chunk])
              .onConflictDoNothing({
                target: [
                  observedFacts.source,
                  observedFacts.subjectKind,
                  observedFacts.subjectKey,
                  observedFacts.factKind,
                  observedFacts.coversFrom,
                  observedFacts.coversTo,
                  observedFacts.observedAt,
                ],
              })
              .returning({ observedAt: observedFacts.observedAt }),
          ).pipe(Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })));
        },
      );

      return { readProviderOpponents, recordProviderOpponents } as const;
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

function observationKey(row: {
  readonly source: string;
  readonly subjectKind: string;
  readonly subjectKey: string;
  readonly factKind: string;
  readonly coversFrom: string;
  readonly coversTo: string;
  readonly observedAt: Date;
}): string {
  return [
    row.source,
    row.subjectKind,
    row.subjectKey,
    row.factKind,
    row.coversFrom,
    row.coversTo,
    row.observedAt.toISOString(),
  ].join("|");
}
