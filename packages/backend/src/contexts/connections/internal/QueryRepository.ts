import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";
import { Array as EffectArray } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import {
  ConnectionCredentialGeneration,
  ConnectionId,
  ConnectionStatus,
  ProviderKey,
} from "#contexts/connections/Connection.ts";
import type { ConnectionError } from "#contexts/connections/Connection.ts";
import { FantasyTeam, TeamId } from "#contexts/connections/FantasyTeam.ts";
import {
  QueryConnectionNotReady,
  QueryPersistenceFailed,
  QueryTeamNotFound,
} from "#contexts/connections/QueryValues.ts";
import { anyOf } from "#database/dbUtilities.ts";

import { ConnectionRepository } from "./ConnectionRepository.ts";
import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import {
  FantasyTeamRow,
  providerConnections,
  providerCredentials,
  providerTeams,
} from "./ConnectionTables.ts";

export type OwnedTeam = {
  readonly team: FantasyTeam;
  readonly connection: {
    readonly id: ConnectionId;
    readonly status: ConnectionStatus;
    readonly provider: ProviderKey;
    readonly generation: ConnectionCredentialGeneration;
    readonly envelope: string;
  };
};

export class QueryRepository extends Context.Service<QueryRepository>()(
  "@lineupkeep/backend/contexts/connections/internal/QueryRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;
      const connections = yield* ConnectionRepository;

      const decodeOwnedTeam = (row: {
        readonly id: string;
        readonly connectionId: string;
        readonly userId: string;
        readonly provider: string;
        readonly providerTeamKey: string;
        readonly providerLeagueKey: string;
        readonly league: "nfl" | "nhl" | "mlb" | "nba";
        readonly sport: "football" | "hockey" | "baseball" | "basketball";
        readonly season: number;
        readonly name: string;
        readonly leagueName: string | null;
        readonly providerUrl: string | null;
        readonly availability: "available" | "unavailable";
        readonly automationState: unknown;
        readonly automationStatus: "disabled" | "enabled" | "paused-until-fantasy-day-end";
        readonly ownerNote: string | null;
        readonly ownerNoteUpdatedAt: Date | null;
        readonly lastSeenAt: Date;
        readonly createdAt: Date;
        readonly updatedAt: Date;
        readonly status: "linking" | "ready" | "reconnect-required" | "disconnected";
        readonly generation: number | null;
        readonly envelope: string | null;
        readonly credentialProvider: string | null;
      }): Effect.Effect<OwnedTeam, QueryConnectionNotReady | QueryPersistenceFailed> =>
        Effect.gen(function* () {
          const teamId = yield* Schema.decodeEffect(TeamId)(row.id).pipe(
            Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
          );
          const team = yield* Schema.decodeEffect(FantasyTeamRow)(row).pipe(
            Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
          );
          const status = yield* Schema.decodeEffect(ConnectionStatus)(row.status).pipe(
            Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
          );
          if (status !== "ready") {
            return yield* QueryConnectionNotReady.make({ team: teamId, status });
          }
          if (row.generation === null || row.envelope === null || row.credentialProvider === null) {
            return yield* QueryPersistenceFailed.make({
              cause: new Error("The ready connection has no credential"),
            });
          }
          return {
            team,
            connection: {
              id: yield* Schema.decodeEffect(ConnectionId)(row.connectionId).pipe(
                Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
              ),
              status,
              provider: yield* Schema.decodeEffect(ProviderKey)(row.credentialProvider).pipe(
                Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
              ),
              generation: yield* Schema.decodeEffect(ConnectionCredentialGeneration)(
                row.generation,
              ).pipe(Effect.mapError((cause) => QueryPersistenceFailed.make({ cause }))),
              envelope: row.envelope,
            },
          } satisfies OwnedTeam;
        });

      const loadOwnedTeam = Effect.fn("QueryRepository.loadOwnedTeam")(function* (
        userId: UserId,
        teamId: TeamId,
      ) {
        const rows = yield* database
          .select({
            id: providerTeams.id,
            connectionId: providerTeams.connectionId,
            userId: providerTeams.userId,
            provider: providerTeams.provider,
            providerTeamKey: providerTeams.providerTeamKey,
            providerLeagueKey: providerTeams.providerLeagueKey,
            league: providerTeams.league,
            sport: providerTeams.sport,
            season: providerTeams.season,
            name: providerTeams.name,
            leagueName: providerTeams.leagueName,
            providerUrl: providerTeams.providerUrl,
            availability: providerTeams.availability,
            automationState: providerTeams.automationState,
            automationStatus: providerTeams.automationStatus,
            ownerNote: providerTeams.ownerNote,
            ownerNoteUpdatedAt: providerTeams.ownerNoteUpdatedAt,
            lastSeenAt: providerTeams.lastSeenAt,
            createdAt: providerTeams.createdAt,
            updatedAt: providerTeams.updatedAt,
            status: providerConnections.status,
            generation: providerCredentials.generation,
            envelope: providerCredentials.envelope,
            credentialProvider: providerCredentials.provider,
          })
          .from(providerTeams)
          .innerJoin(
            providerConnections,
            and(
              eq(providerConnections.id, providerTeams.connectionId),
              eq(providerConnections.userId, userId),
            ),
          )
          .leftJoin(
            providerCredentials,
            and(
              eq(providerCredentials.connectionId, providerTeams.connectionId),
              eq(providerCredentials.userId, userId),
            ),
          )
          .where(and(eq(providerTeams.userId, userId), eq(providerTeams.id, teamId)))
          .limit(1)
          .pipe(Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })));

        const row = rows[0];
        if (row === undefined) {
          return yield* QueryTeamNotFound.make({ team: teamId });
        }
        const team = yield* Schema.decodeEffect(FantasyTeamRow)(row).pipe(
          Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
        );
        const status = yield* Schema.decodeEffect(ConnectionStatus)(row.status).pipe(
          Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
        );
        if (status !== "ready") {
          return yield* QueryConnectionNotReady.make({ team: teamId, status });
        }
        if (row.generation === null || row.envelope === null || row.credentialProvider === null) {
          return yield* QueryPersistenceFailed.make({
            cause: new Error("The ready connection has no credential"),
          });
        }
        return {
          team,
          connection: {
            id: team.connectionId,
            status,
            provider: yield* Schema.decodeEffect(ProviderKey)(row.credentialProvider).pipe(
              Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
            ),
            generation: yield* Schema.decodeEffect(ConnectionCredentialGeneration)(
              row.generation,
            ).pipe(Effect.mapError((cause) => QueryPersistenceFailed.make({ cause }))),
            envelope: row.envelope,
          },
        } satisfies OwnedTeam;
      });

      const loadOwnedTeams = Effect.fn("QueryRepository.loadOwnedTeams")(function* (
        userId: UserId,
        teamIds: ReadonlyArray<TeamId>,
      ) {
        const ids = [...new Set(teamIds)];
        if (!EffectArray.isArrayNonEmpty(ids)) {
          return [];
        }
        const rows = yield* database
          .select({
            id: providerTeams.id,
            connectionId: providerTeams.connectionId,
            userId: providerTeams.userId,
            provider: providerTeams.provider,
            providerTeamKey: providerTeams.providerTeamKey,
            providerLeagueKey: providerTeams.providerLeagueKey,
            league: providerTeams.league,
            sport: providerTeams.sport,
            season: providerTeams.season,
            name: providerTeams.name,
            leagueName: providerTeams.leagueName,
            providerUrl: providerTeams.providerUrl,
            availability: providerTeams.availability,
            automationState: providerTeams.automationState,
            automationStatus: providerTeams.automationStatus,
            ownerNote: providerTeams.ownerNote,
            ownerNoteUpdatedAt: providerTeams.ownerNoteUpdatedAt,
            lastSeenAt: providerTeams.lastSeenAt,
            createdAt: providerTeams.createdAt,
            updatedAt: providerTeams.updatedAt,
            status: providerConnections.status,
            generation: providerCredentials.generation,
            envelope: providerCredentials.envelope,
            credentialProvider: providerCredentials.provider,
          })
          .from(providerTeams)
          .innerJoin(
            providerConnections,
            and(
              eq(providerConnections.id, providerTeams.connectionId),
              eq(providerConnections.userId, userId),
            ),
          )
          .leftJoin(
            providerCredentials,
            and(
              eq(providerCredentials.connectionId, providerTeams.connectionId),
              eq(providerCredentials.userId, userId),
            ),
          )
          .where(and(eq(providerTeams.userId, userId), anyOf(providerTeams.id, ids)))
          .pipe(Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })));
        const byId = new Map(rows.map((row) => [row.id, row]));
        const owned: Array<OwnedTeam> = [];
        for (const teamId of teamIds) {
          const row = byId.get(teamId);
          if (row === undefined) {
            return yield* QueryTeamNotFound.make({ team: teamId });
          }
          owned.push(yield* decodeOwnedTeam(row));
        }
        return owned;
      });

      const readLeagueOwnedTeamKeys = Effect.fn("QueryRepository.readLeagueOwnedTeamKeys")(
        function* (input: {
          readonly userId: UserId;
          readonly provider: ProviderKey;
          readonly providerLeagueKey: string;
        }) {
          const rows = yield* database
            .select({ providerTeamKey: providerTeams.providerTeamKey })
            .from(providerTeams)
            .where(
              and(
                eq(providerTeams.userId, input.userId),
                eq(providerTeams.provider, input.provider),
                eq(providerTeams.providerLeagueKey, input.providerLeagueKey),
              ),
            )
            .pipe(Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })));
          return rows.map((row) => row.providerTeamKey);
        },
      );

      const recordSessionRejectedMany = Effect.fn("QueryRepository.recordSessionRejectedMany")(
        function* (userId: UserId, teams: ReadonlyArray<OwnedTeam>) {
          if (teams.length === 0) {
            return;
          }
          yield* connections
            .markReconnectRequired(
              userId,
              teams.map((team) => ({
                id: team.connection.id,
                expectedGeneration: team.connection.generation,
              })),
            )
            .pipe(
              Effect.asVoid,
              Effect.catch((error: ConnectionError) =>
                Effect.annotateCurrentSpan("query.reconnect_mark_failed", error._tag).pipe(
                  Effect.asVoid,
                ),
              ),
            );
        },
      );

      const recordSessionRejected = Effect.fn("QueryRepository.recordSessionRejected")(function* (
        userId: UserId,
        team: OwnedTeam,
      ) {
        yield* recordSessionRejectedMany(userId, [team]);
      });

      return {
        loadOwnedTeam,
        loadOwnedTeams,
        readLeagueOwnedTeamKeys,
        recordSessionRejected,
        recordSessionRejectedMany,
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
