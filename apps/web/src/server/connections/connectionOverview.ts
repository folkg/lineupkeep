import type { UserId } from "@lineupkeep/backend/auth/User";
import type {
  ConnectionError,
  ProviderConnection,
} from "@lineupkeep/backend/connections/Connection";
import { Connections } from "@lineupkeep/backend/connections/Connections";
import type { FantasyTeam } from "@lineupkeep/backend/connections/FantasyTeam";
import { Effect } from "effect";
import { Array as EffectArray } from "effect";
import { dual } from "effect/Function";

import type {
  ConnectionChangeView,
  ConnectionView,
} from "#contracts/connections/connectionContract.ts";

import { toConnectionView } from "./connectionPresentation.ts";

export function loadConnectionViews(
  userId: UserId,
): Effect.Effect<ReadonlyArray<ConnectionView>, ConnectionError, Connections> {
  return Effect.gen(function* () {
    const connections = yield* Connections.use((service) => service.list(userId));
    const teams = yield* Connections.use((service) => service.listTeams(userId));
    const counts = countTeamsByConnection(teams);
    return EffectArray.map(connections, (connection) =>
      toConnectionView(connection, teamCount(counts, connection.id)),
    );
  });
}

export const loadConnectionChange: {
  (
    connection: ProviderConnection,
  ): (userId: UserId) => Effect.Effect<ConnectionChangeView, ConnectionError, Connections>;
  (
    userId: UserId,
    connection: ProviderConnection,
  ): Effect.Effect<ConnectionChangeView, ConnectionError, Connections>;
} = dual(
  2,
  (
    userId: UserId,
    connection: ProviderConnection,
  ): Effect.Effect<ConnectionChangeView, ConnectionError, Connections> =>
    Effect.gen(function* () {
      const connections = yield* Connections.use((service) => service.list(userId));
      const teams = yield* Connections.use((service) => service.listTeams(userId));
      const counts = countTeamsByConnection(teams);
      return {
        connection: toConnectionView(connection, teamCount(counts, connection.id)),
        connections: EffectArray.map(connections, (candidate) =>
          toConnectionView(candidate, teamCount(counts, candidate.id)),
        ),
      } satisfies ConnectionChangeView;
    }),
);

function countTeamsByConnection(teams: ReadonlyArray<FantasyTeam>): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const team of teams) {
    counts.set(team.connectionId, (counts.get(team.connectionId) ?? 0) + 1);
  }
  return counts;
}

function teamCount(counts: ReadonlyMap<string, number>, connectionId: string): number {
  return counts.get(connectionId) ?? 0;
}
