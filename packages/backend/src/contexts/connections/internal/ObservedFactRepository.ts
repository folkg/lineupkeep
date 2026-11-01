import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { Array, Context, DateTime, Effect, Layer, Schema } from "effect";

import type { ProviderKey } from "#contexts/connections/Connection.ts";
import type { FantasySport, TeamId } from "#contexts/connections/FantasyTeam.ts";
import type { ProfessionalGame } from "#contexts/connections/ProfessionalGame.ts";
import { QueryPersistenceFailed } from "#contexts/connections/QueryValues.ts";
import { anyOf, maxInsertRows } from "#database/dbUtilities.ts";
import { chunked } from "#utilities/collections.ts";

import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import type {
  FactWindow,
  ObservedFactConfidence,
  ObservedFactKind,
  ObservedFactSubjectKind,
  ProviderOpponentValue,
} from "./ObservedFacts.ts";
import { professionalGameValue, providerOpponentValue } from "./ObservedFacts.ts";
import {
  observedFacts,
  professionalTeamIdentities,
  ProfessionalTeamIdentityRow,
} from "./ObservedFactTables.ts";

type FactObservation<Value> = {
  readonly source: string;
  readonly subjectKey: string;
  readonly window: FactWindow;
  readonly value: Value;
  readonly observedAt: DateTime.Utc;
  readonly sourceReference: string;
};

type FactObservationWrite<Value> = Omit<FactObservation<Value>, "source">;

export type ProviderOpponentObservation = FactObservation<ProviderOpponentValue>;
export type ProviderOpponentObservationWrite = Omit<
  FactObservationWrite<ProviderOpponentValue>,
  "subjectKey"
>;
export type ProfessionalGameObservation = FactObservation<ProfessionalGame>;
export type ProfessionalGameObservationWrite = FactObservationWrite<ProfessionalGame>;

export type TeamIdentity = {
  readonly sport: FantasySport;
  readonly source: string;
  readonly sourceTeamIdentifier: string;
  readonly provider: ProviderKey;
  readonly providerTeamKey: string;
  readonly observedAt: DateTime.Utc;
};

export class ObservedFactRepository extends Context.Service<ObservedFactRepository>()(
  "@lineupkeep/backend/contexts/connections/internal/ObservedFactRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;

      const readFacts = <Value>(input: {
        readonly factKind: ObservedFactKind;
        readonly subjectKind: ObservedFactSubjectKind;
        readonly subjectKey: string | undefined;
        readonly from: string;
        readonly to: string;
        readonly value: Schema.Codec<Value, unknown, never, never>;
      }): Effect.Effect<ReadonlyArray<FactObservation<Value>>, QueryPersistenceFailed> =>
        database
          .select()
          .from(observedFacts)
          .where(
            and(
              eq(observedFacts.subjectKind, input.subjectKind),
              eq(observedFacts.factKind, input.factKind),
              eq(observedFacts.coversFrom, observedFacts.coversTo),
              gte(observedFacts.coversFrom, input.from),
              lte(observedFacts.coversFrom, input.to),
              input.subjectKey === undefined
                ? undefined
                : eq(observedFacts.subjectKey, input.subjectKey),
            ),
          )
          .orderBy(desc(observedFacts.observedAt))
          .pipe(
            Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
            Effect.flatMap((rows) =>
              Effect.forEach(rows, (row) =>
                Schema.decodeUnknownEffect(input.value)(row.value).pipe(
                  Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
                  Effect.map((value): FactObservation<Value> => ({
                    source: row.source,
                    subjectKey: row.subjectKey,
                    window: { from: row.coversFrom, to: row.coversTo },
                    value,
                    observedAt: DateTime.fromDateUnsafe(row.observedAt),
                    sourceReference: row.sourceReference,
                  })),
                ),
              ),
            ),
          );

      const recordFacts = (input: {
        readonly factKind: ObservedFactKind;
        readonly subjectKind: ObservedFactSubjectKind;
        readonly source: string;
        readonly confidence: ObservedFactConfidence;
        readonly observations: ReadonlyArray<FactObservationWrite<unknown>>;
      }): Effect.Effect<void, QueryPersistenceFailed> => {
        const rows = input.observations
          .map((observation) => ({
            source: input.source,
            subjectKind: input.subjectKind,
            subjectKey: observation.subjectKey,
            factKind: input.factKind,
            coversFrom: observation.window.from,
            coversTo: observation.window.to,
            value: observation.value,
            observedAt: DateTime.toDateUtc(observation.observedAt),
            confidence: input.confidence,
            sourceReference: observation.sourceReference,
          }))
          .toSorted((left, right) => observationKey(left).localeCompare(observationKey(right)));
        return chunked(rows, maxInsertRows(observedFacts), (chunk) =>
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
      };

      const readProviderOpponents = Effect.fn("ObservedFactRepository.readProviderOpponents")(
        (input: { readonly subjectKey: TeamId; readonly from: string; readonly to: string }) =>
          readFacts({
            factKind: "provider_opponent",
            subjectKind: "fantasy_team",
            subjectKey: input.subjectKey,
            from: input.from,
            to: input.to,
            value: providerOpponentValue,
          }),
      );

      const recordProviderOpponents = Effect.fn("ObservedFactRepository.recordProviderOpponents")(
        (input: {
          readonly subjectKey: TeamId;
          readonly source: ProviderKey;
          readonly confidence: ObservedFactConfidence;
          readonly observations: ReadonlyArray<ProviderOpponentObservationWrite>;
        }) =>
          recordFacts({
            factKind: "provider_opponent",
            subjectKind: "fantasy_team",
            source: input.source,
            confidence: input.confidence,
            observations: input.observations.map((observation) => ({
              ...observation,
              subjectKey: input.subjectKey,
            })),
          }),
      );

      const readProfessionalGames = Effect.fn("ObservedFactRepository.readProfessionalGames")(
        (input: { readonly from: string; readonly to: string }) =>
          database
            .select()
            .from(observedFacts)
            .where(
              and(
                eq(observedFacts.subjectKind, "professional_game"),
                eq(observedFacts.factKind, "professional_game"),
                lte(observedFacts.coversFrom, input.to),
                gte(observedFacts.coversTo, input.from),
              ),
            )
            .orderBy(desc(observedFacts.observedAt))
            .pipe(
              Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
              Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeProfessionalGame(row))),
            ),
      );

      const recordProfessionalGames = Effect.fn("ObservedFactRepository.recordProfessionalGames")(
        (input: {
          readonly source: string;
          readonly confidence: ObservedFactConfidence;
          readonly observations: ReadonlyArray<ProfessionalGameObservationWrite>;
        }) =>
          recordFacts({
            factKind: "professional_game",
            subjectKind: "professional_game",
            source: input.source,
            confidence: input.confidence,
            observations: input.observations.map((observation) => ({
              ...observation,
              value: Schema.encodeSync(professionalGameValue)(observation.value),
            })),
          }),
      );

      const readSourceTeamIdentities = Effect.fn("ObservedFactRepository.readSourceTeamIdentities")(
        function* (input: { readonly sport: FantasySport; readonly source: string }) {
          const rows = yield* database
            .select()
            .from(professionalTeamIdentities)
            .where(
              and(
                eq(professionalTeamIdentities.sport, input.sport),
                eq(professionalTeamIdentities.source, input.source),
              ),
            )
            .orderBy(
              asc(professionalTeamIdentities.sourceTeamIdentifier),
              asc(professionalTeamIdentities.providerTeamKey),
            )
            .pipe(Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })));
          return yield* Effect.forEach(rows, decodeTeamIdentity);
        },
      );

      const readProviderTeamIdentities = Effect.fn(
        "ObservedFactRepository.readProviderTeamIdentities",
      )(function* (input: {
        readonly sport: FantasySport;
        readonly identifiers: ReadonlyArray<string>;
      }) {
        const identifiers = [...new Set(input.identifiers)];
        if (!Array.isArrayNonEmpty(identifiers)) {
          return [];
        }
        const rows = yield* database
          .select()
          .from(professionalTeamIdentities)
          .where(
            and(
              eq(professionalTeamIdentities.sport, input.sport),
              eq(professionalTeamIdentities.source, professionalTeamIdentities.provider),
              anyOf(professionalTeamIdentities.sourceTeamIdentifier, identifiers),
            ),
          )
          .pipe(Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })));
        return yield* Effect.forEach(rows, decodeTeamIdentity);
      });

      const recordTeamIdentities = Effect.fn("ObservedFactRepository.recordTeamIdentities")(
        function* (identities: ReadonlyArray<TeamIdentity>) {
          const rows = identities
            .map((identity) => ({
              sport: identity.sport,
              source: identity.source,
              sourceTeamIdentifier: identity.sourceTeamIdentifier,
              provider: identity.provider,
              providerTeamKey: identity.providerTeamKey,
              observedAt: DateTime.toDateUtc(identity.observedAt),
            }))
            .toSorted((left, right) => identityKey(left).localeCompare(identityKey(right)));
          yield* chunked(rows, maxInsertRows(professionalTeamIdentities), (chunk) =>
            database
              .insert(professionalTeamIdentities)
              .values([...chunk])
              .onConflictDoNothing()
              .returning({ providerTeamKey: professionalTeamIdentities.providerTeamKey }),
          ).pipe(Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })));
        },
      );

      return {
        readProviderOpponents,
        recordProviderOpponents,
        readProfessionalGames,
        recordProfessionalGames,
        readSourceTeamIdentities,
        readProviderTeamIdentities,
        recordTeamIdentities,
      } as const;
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

const decodeProfessionalGame = (
  row: typeof observedFacts.$inferSelect,
): Effect.Effect<ProfessionalGameObservation, QueryPersistenceFailed> =>
  Schema.decodeUnknownEffect(professionalGameValue)(row.value).pipe(
    Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
    Effect.map((value): ProfessionalGameObservation => ({
      source: row.source,
      subjectKey: row.subjectKey,
      window: { from: row.coversFrom, to: row.coversTo },
      value,
      observedAt: DateTime.fromDateUnsafe(row.observedAt),
      sourceReference: row.sourceReference,
    })),
  );

const decodeTeamIdentity = (
  row: typeof professionalTeamIdentities.$inferSelect,
): Effect.Effect<TeamIdentity, QueryPersistenceFailed> =>
  Schema.decodeEffect(ProfessionalTeamIdentityRow)(row).pipe(
    Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
    Effect.map((decoded): TeamIdentity => ({
      sport: decoded.sport,
      source: decoded.source,
      sourceTeamIdentifier: decoded.sourceTeamIdentifier,
      provider: decoded.provider,
      providerTeamKey: decoded.providerTeamKey,
      observedAt: decoded.observedAt,
    })),
  );

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

function identityKey(identity: {
  readonly sport: string;
  readonly source: string;
  readonly sourceTeamIdentifier: string;
  readonly provider: string;
  readonly providerTeamKey: string;
  readonly observedAt: Date;
}): string {
  return [
    identity.sport,
    identity.source,
    identity.sourceTeamIdentifier,
    identity.provider,
    identity.providerTeamKey,
    identity.observedAt.toISOString(),
  ].join("|");
}
