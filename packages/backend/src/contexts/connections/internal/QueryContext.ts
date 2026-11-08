import { Effect, Ref } from "effect";
import type { Redacted } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { FantasyTeam, TeamId } from "#contexts/connections/FantasyTeam.ts";
import type { Provider, ProviderSessionMaterial } from "#contexts/connections/Provider.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";
import type { TeamOwnerNote } from "#contexts/connections/QueryValues.ts";
import { type QueryError, QueryPersistenceFailed } from "#contexts/connections/QueryValues.ts";

import type { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import type { OwnedTeam, QueryRepository } from "./QueryRepository.ts";

export type TeamContext = {
  readonly userId: UserId;
  readonly owned: OwnedTeam;
  readonly session: Redacted.Redacted<string>;
  readonly provider: Provider;
  readonly sessionProven: Ref.Ref<boolean>;
  readonly sessionRejected: Ref.Ref<boolean>;
};

export function loadTeamContext(
  repository: QueryRepository["Service"],
  encryption: ConnectionCredentialEncryption["Service"],
  registry: ProviderRegistry["Service"],
  userId: UserId,
  teamId: TeamId,
): Effect.Effect<TeamContext, QueryError> {
  return repository.loadOwnedTeam(userId, teamId).pipe(
    Effect.flatMap((owned) =>
      owned.team.connectionId !== owned.connection.id ||
      owned.team.provider !== owned.connection.provider
        ? Effect.fail(
            QueryPersistenceFailed.make({
              cause: new Error(
                "A team resolved to a connection it does not belong to; no provider request was made",
              ),
            }),
          )
        : Effect.all([
            encryption
              .open({
                userId,
                connectionId: owned.connection.id,
                provider: owned.connection.provider,
                envelope: owned.connection.envelope,
              })
              .pipe(Effect.mapError((cause) => QueryPersistenceFailed.make({ cause }))),
            registry
              .requireProvider(owned.connection.provider)
              .pipe(
                Effect.mapError((error) =>
                  QueryPersistenceFailed.make({ cause: new Error(error.message) }),
                ),
              ),
            Ref.make(false),
            Ref.make(false),
          ]).pipe(
            Effect.map(([session, provider, sessionProven, sessionRejected]) => ({
              userId,
              owned,
              session,
              provider,
              sessionProven,
              sessionRejected,
            })),
          ),
    ),
  );
}

export function providerIdentity(context: TeamContext): ProviderSessionMaterial {
  return {
    provider: context.owned.connection.provider,
    session: context.session,
  };
}

export function ownerNoteOf(team: FantasyTeam): TeamOwnerNote {
  return team.ownerNote === null
    ? { status: "not_set" }
    : {
        status: "provided",
        text: team.ownerNote,
        ...(team.ownerNoteUpdatedAt === null ? {} : { updatedAt: team.ownerNoteUpdatedAt }),
      };
}
