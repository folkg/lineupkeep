import { Effect } from "effect";
import type { Redacted } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { TeamId } from "#contexts/connections/FantasyTeam.ts";
import type { ProviderSessionMaterial } from "#contexts/connections/Provider.ts";
import { type QueryError, QueryPersistenceFailed } from "#contexts/connections/QueryValues.ts";

import type { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import type { OwnedTeam, QueryRepository } from "./QueryRepository.ts";

export type TeamContext = {
  readonly userId: UserId;
  readonly owned: OwnedTeam;
  readonly session: Redacted.Redacted<string>;
};

export function loadTeamContext(
  repository: QueryRepository["Service"],
  encryption: ConnectionCredentialEncryption["Service"],
  userId: UserId,
  teamId: TeamId,
): Effect.Effect<TeamContext, QueryError> {
  return repository.loadOwnedTeam(userId, teamId).pipe(
    Effect.flatMap((owned) =>
      encryption
        .decrypt({
          userId,
          connectionId: owned.connection.id,
          provider: owned.connection.provider,
          envelope: owned.connection.envelope,
        })
        .pipe(
          Effect.map((session) => ({ userId, owned, session })),
          Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })),
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
