import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { Array, Context, DateTime, Effect, Layer, Schema } from "effect";

import type { ProviderKey } from "#contexts/connections/Connection.ts";
import type { FantasySport, TeamId } from "#contexts/connections/FantasyTeam.ts";
import type { PublishedProfessionalGame } from "#contexts/connections/ProfessionalGame.ts";
import { QueryPersistenceFailed } from "#contexts/connections/QueryValues.ts";
import { anyOf, excludedValues, incomingIsNewer, maxInsertRows } from "#database/dbUtilities.ts";
import { chunked } from "#utilities/collections.ts";

import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import type {
  ScheduleObservationWindow,
  ScheduleObservationConfidence,
  ScheduleObservationKind,
  ScheduleObservationSubjectKind,
  ProviderOpponentValue,
} from "./ScheduleObservations.ts";
import { publishedProfessionalGameValue, providerOpponentValue } from "./ScheduleObservations.ts";
import {
  scheduleObservations,
  professionalTeamIdentities,
  ProfessionalTeamIdentityRow,
} from "./ScheduleObservationTables.ts";

type ScheduleObservation<Value> = {
  readonly source: string;
  readonly subjectKey: string;
  readonly window: ScheduleObservationWindow;
  readonly value: Value;
  readonly observedAt: DateTime.Utc;
  readonly sourceReference: string;
};

type ScheduleObservationWrite<Value> = Omit<ScheduleObservation<Value>, "source">;

export type ProviderOpponentObservation = ScheduleObservation<ProviderOpponentValue>;
export type ProviderOpponentObservationWrite = Omit<
  ScheduleObservationWrite<ProviderOpponentValue>,
  "subjectKey"
>;
export type ProfessionalGameObservation = ScheduleObservation<PublishedProfessionalGame>;
export type ProfessionalGameObservationWrite = ScheduleObservationWrite<PublishedProfessionalGame>;

export type TeamIdentity = {
  readonly sport: FantasySport;
  readonly source: string;
  readonly sourceTeamIdentifier: string;
  readonly provider: ProviderKey;
  readonly providerTeamKey: string;
  readonly observedAt: DateTime.Utc;
};

export class ScheduleObservationRepository extends Context.Service<ScheduleObservationRepository>()(
  "@lineupkeep/backend/contexts/connections/internal/ScheduleObservationRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;

      const readObservations = <Value>(input: {
        readonly observationKind: ScheduleObservationKind;
        readonly subjectKind: ScheduleObservationSubjectKind;
        readonly subjectKey: string | undefined;
        readonly from: string;
        readonly to: string;
        readonly value: Schema.Codec<Value, unknown, never, never>;
      }): Effect.Effect<ReadonlyArray<ScheduleObservation<Value>>, QueryPersistenceFailed> =>
        database
          .select()
          .from(scheduleObservations)
          .where(
            and(
              eq(scheduleObservations.subjectKind, input.subjectKind),
              eq(scheduleObservations.observationKind, input.observationKind),
              eq(scheduleObservations.coversFrom, scheduleObservations.coversTo),
              gte(scheduleObservations.coversFrom, input.from),
              lte(scheduleObservations.coversFrom, input.to),
              input.subjectKey === undefined
                ? undefined
                : eq(scheduleObservations.subjectKey, input.subjectKey),
            ),
          )
          .orderBy(desc(scheduleObservations.observedAt))
          .pipe(
            Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
            Effect.flatMap((rows) =>
              Effect.forEach(rows, (row) =>
                Schema.decodeUnknownEffect(input.value)(row.value).pipe(
                  Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
                  Effect.map((value): ScheduleObservation<Value> => ({
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

      const recordObservations = (input: {
        readonly observationKind: ScheduleObservationKind;
        readonly subjectKind: ScheduleObservationSubjectKind;
        readonly source: string;
        readonly confidence: ScheduleObservationConfidence;
        readonly observations: ReadonlyArray<ScheduleObservationWrite<unknown>>;
      }): Effect.Effect<void, QueryPersistenceFailed> => {
        const observations = input.observations.map((observation) => ({
          source: input.source,
          subjectKind: input.subjectKind,
          subjectKey: observation.subjectKey,
          observationKind: input.observationKind,
          coversFrom: observation.window.from,
          coversTo: observation.window.to,
          value: observation.value,
          observedAt: DateTime.toDateUtc(observation.observedAt),
          confidence: input.confidence,
          sourceReference: observation.sourceReference,
        }));
        const newestByWindow = new Map<string, (typeof observations)[number]>();
        for (const observation of observations) {
          const key = scheduleObservationKey(observation);
          const previous = newestByWindow.get(key);
          if (previous === undefined || isNewerObservation(observation, previous)) {
            newestByWindow.set(key, observation);
          }
        }
        const rows = [...newestByWindow.values()].toSorted((left, right) =>
          observationKey(left).localeCompare(observationKey(right)),
        );
        return chunked(rows, maxInsertRows(scheduleObservations), (chunk) =>
          database
            .insert(scheduleObservations)
            .values([...chunk])
            .onConflictDoUpdate({
              target: [
                scheduleObservations.source,
                scheduleObservations.subjectKind,
                scheduleObservations.subjectKey,
                scheduleObservations.observationKind,
                scheduleObservations.coversFrom,
                scheduleObservations.coversTo,
              ],
              set: excludedValues(scheduleObservations, [
                "value",
                "observedAt",
                "confidence",
                "sourceReference",
              ]),
              setWhere: incomingIsNewer(scheduleObservations.observedAt),
            })
            .returning({ observedAt: scheduleObservations.observedAt }),
        ).pipe(Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })));
      };

      const readProviderOpponents = Effect.fn(
        "ScheduleObservationRepository.readProviderOpponents",
      )((input: { readonly subjectKey: TeamId; readonly from: string; readonly to: string }) =>
        readObservations({
          observationKind: "provider_opponent",
          subjectKind: "fantasy_team",
          subjectKey: input.subjectKey,
          from: input.from,
          to: input.to,
          value: providerOpponentValue,
        }),
      );

      const recordProviderOpponents = Effect.fn(
        "ScheduleObservationRepository.recordProviderOpponents",
      )(
        (input: {
          readonly subjectKey: TeamId;
          readonly source: ProviderKey;
          readonly confidence: ScheduleObservationConfidence;
          readonly observations: ReadonlyArray<ProviderOpponentObservationWrite>;
        }) =>
          recordObservations({
            observationKind: "provider_opponent",
            subjectKind: "fantasy_team",
            source: input.source,
            confidence: input.confidence,
            observations: input.observations.map((observation) => ({
              ...observation,
              subjectKey: input.subjectKey,
            })),
          }),
      );

      const readProfessionalGames = Effect.fn(
        "ScheduleObservationRepository.readProfessionalGames",
      )((input: { readonly from: string; readonly to: string }) =>
        database
          .select()
          .from(scheduleObservations)
          .where(
            and(
              eq(scheduleObservations.subjectKind, "professional_game"),
              eq(scheduleObservations.observationKind, "professional_game"),
              lte(scheduleObservations.coversFrom, input.to),
              gte(scheduleObservations.coversTo, input.from),
            ),
          )
          .orderBy(desc(scheduleObservations.observedAt))
          .pipe(
            Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
            Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeProfessionalGame(row))),
          ),
      );

      const recordProfessionalGames = Effect.fn(
        "ScheduleObservationRepository.recordProfessionalGames",
      )(
        (input: {
          readonly source: string;
          readonly confidence: ScheduleObservationConfidence;
          readonly observations: ReadonlyArray<ProfessionalGameObservationWrite>;
        }) =>
          recordObservations({
            observationKind: "professional_game",
            subjectKind: "professional_game",
            source: input.source,
            confidence: input.confidence,
            observations: input.observations.map((observation) => ({
              ...observation,
              value: Schema.encodeSync(publishedProfessionalGameValue)(observation.value),
            })),
          }),
      );

      const readSourceTeamIdentities = Effect.fn(
        "ScheduleObservationRepository.readSourceTeamIdentities",
      )(function* (input: { readonly sport: FantasySport; readonly source: string }) {
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
      });

      const readProviderTeamIdentities = Effect.fn(
        "ScheduleObservationRepository.readProviderTeamIdentities",
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

      const recordTeamIdentities = Effect.fn("ScheduleObservationRepository.recordTeamIdentities")(
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
  row: typeof scheduleObservations.$inferSelect,
): Effect.Effect<ProfessionalGameObservation, QueryPersistenceFailed> =>
  Schema.decodeUnknownEffect(publishedProfessionalGameValue)(row.value).pipe(
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

function scheduleObservationKey(row: {
  readonly source: string;
  readonly subjectKind: string;
  readonly subjectKey: string;
  readonly observationKind: string;
  readonly coversFrom: string;
  readonly coversTo: string;
}): string {
  return JSON.stringify([
    row.source,
    row.subjectKind,
    row.subjectKey,
    row.observationKind,
    row.coversFrom,
    row.coversTo,
  ]);
}

function isNewerObservation(
  candidate: { readonly observedAt: Date; readonly sourceReference: string },
  previous: { readonly observedAt: Date; readonly sourceReference: string },
): boolean {
  const difference = candidate.observedAt.getTime() - previous.observedAt.getTime();
  return (
    difference > 0 || (difference === 0 && candidate.sourceReference > previous.sourceReference)
  );
}

function observationKey(row: {
  readonly source: string;
  readonly subjectKind: string;
  readonly subjectKey: string;
  readonly observationKind: string;
  readonly coversFrom: string;
  readonly coversTo: string;
  readonly observedAt: Date;
}): string {
  return [
    row.source,
    row.subjectKind,
    row.subjectKey,
    row.observationKind,
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
