import { Effect } from "effect";
import type { Redacted } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { TeamId } from "#contexts/connections/FantasyTeam.ts";
import type { Provider, ProviderSessionMaterial } from "#contexts/connections/Provider.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";
import { type QueryError, QueryPersistenceFailed } from "#contexts/connections/QueryValues.ts";

import type { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import type { OwnedTeam, QueryRepository } from "./QueryRepository.ts";

export type TeamContext = {
  readonly userId: UserId;
  readonly owned: OwnedTeam;
  readonly session: Redacted.Redacted<string>;
  readonly provider: Provider;
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
      Effect.all([
        encryption
          .decrypt({
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
      ]).pipe(Effect.map(([session, provider]) => ({ userId, owned, session, provider }))),
    ),
  );
}

export function providerIdentity(context: TeamContext): ProviderSessionMaterial {
  return {
    provider: context.owned.connection.provider,
    session: context.session,
  };
}
