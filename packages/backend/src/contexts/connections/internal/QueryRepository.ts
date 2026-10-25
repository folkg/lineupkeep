import { and, eq } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import {
  ConnectionCredentialGeneration,
  ConnectionId,
  ConnectionStatus,
  Provider,
} from "#contexts/connections/Connection.ts";
import type { ConnectionError } from "#contexts/connections/Connection.ts";
import type { FantasyTeam, TeamId } from "#contexts/connections/FantasyTeam.ts";
import {
  QueryConnectionNotReady,
  QueryPersistenceFailed,
  QueryTeamNotFound,
} from "#contexts/connections/QueryValues.ts";

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
    readonly provider: Provider;
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
            availability: providerTeams.availability,
            automationEnabled: providerTeams.automationEnabled,
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
            provider: yield* Schema.decodeEffect(Provider)(row.credentialProvider).pipe(
              Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
            ),
            generation: yield* Schema.decodeEffect(ConnectionCredentialGeneration)(
              row.generation,
            ).pipe(Effect.mapError((cause) => QueryPersistenceFailed.make({ cause }))),
            envelope: row.envelope,
          },
        } satisfies OwnedTeam;
      });

      const recordSessionRejected = Effect.fn("QueryRepository.recordSessionRejected")(function* (
        userId: UserId,
        team: OwnedTeam,
      ) {
        yield* connections
          .markReconnectRequired(userId, [
            {
              id: team.connection.id,
              expectedGeneration: team.connection.generation,
            },
          ])
          .pipe(
            Effect.asVoid,
            Effect.catch((error: ConnectionError) =>
              Effect.annotateCurrentSpan("query.reconnect_mark_failed", error._tag).pipe(
                Effect.asVoid,
              ),
            ),
          );
      });

      return { loadOwnedTeam, recordSessionRejected };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
