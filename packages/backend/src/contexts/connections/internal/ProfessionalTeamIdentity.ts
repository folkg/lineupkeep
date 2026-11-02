import { Array, DateTime, Effect } from "effect";

import type { FantasySport } from "#contexts/connections/FantasyTeam.ts";
import type { GameSourceTeam } from "#contexts/connections/GameSource.ts";
import type { QueryPersistenceFailed } from "#contexts/connections/QueryValues.ts";

import type {
  ScheduleObservationRepository,
  TeamIdentity,
} from "./ScheduleObservationRepository.ts";

export type ProfessionalTeamResolution = {
  readonly bySourceIdentifier: ReadonlyMap<string, string | null>;
  readonly recorded: ReadonlyArray<TeamIdentity>;
};

export function uniqueProviderTeamKeys(
  rows: ReadonlyArray<TeamIdentity>,
): ReadonlyMap<string, string> {
  const grouped = group(
    rows,
    (row) => row.sourceTeamIdentifier,
    (row) => row.providerTeamKey,
  );
  return new Map(
    [...grouped.entries()].flatMap(([identifier, keys]) =>
      keys.size === 1 ? [[identifier, Array.getUnsafe([...keys], 0)] as const] : [],
    ),
  );
}

type TeamClaim = {
  readonly team: GameSourceTeam;
  readonly published: TeamIdentity;
};

export function resolveProfessionalTeams(input: {
  readonly store: ScheduleObservationRepository["Service"];
  readonly sport: FantasySport;
  readonly source: string;
  readonly now: DateTime.Utc;
  readonly teams: ReadonlyArray<GameSourceTeam>;
}): Effect.Effect<ProfessionalTeamResolution, QueryPersistenceFailed> {
  return Effect.gen(function* () {
    const teams = uniqueTeams(input.teams);
    const stored = yield* input.store.readSourceTeamIdentities({
      sport: input.sport,
      source: input.source,
    });
    const keysByIdentifier = keysOf(stored);
    const identifiersByKey = identifiersOf(stored);
    const bySourceIdentifier = new Map<string, string | null>();
    for (const team of teams) {
      bySourceIdentifier.set(
        team.identifier,
        settledKey(keysByIdentifier, identifiersByKey, team.identifier),
      );
    }

    const unpublished = teams.filter((team) => !keysByIdentifier.has(team.identifier));
    if (unpublished.length === 0) {
      return { bySourceIdentifier, recorded: [] };
    }

    const published = yield* input.store.readProviderTeamIdentities({
      sport: input.sport,
      identifiers: unpublished.map((team) => team.abbreviation),
    });
    const claims = unpublished.flatMap((team) => {
      const matches = published.filter((row) => row.sourceTeamIdentifier === team.abbreviation);
      const keys = new Set(matches.map((row) => `${row.provider}|${row.providerTeamKey}`));
      return keys.size === 1 ? [{ team, published: Array.getUnsafe(matches, 0) }] : [];
    });
    const claimedByKey = claimedIdentifiers(claims);

    const recorded: Array<TeamIdentity> = [];
    for (const claim of claims) {
      const unique =
        (claimedByKey.get(claim.published.providerTeamKey)?.size ?? 0) === 1 &&
        !identifiersByKey.has(claim.published.providerTeamKey);
      bySourceIdentifier.set(
        claim.team.identifier,
        unique ? claim.published.providerTeamKey : null,
      );
      if (unique) {
        recorded.push({
          sport: input.sport,
          source: input.source,
          sourceTeamIdentifier: claim.team.identifier,
          provider: claim.published.provider,
          providerTeamKey: claim.published.providerTeamKey,
          observedAt: input.now,
        });
      }
    }
    yield* input.store.recordTeamIdentities(recorded);
    return { bySourceIdentifier, recorded };
  });
}

function keysOf(rows: ReadonlyArray<TeamIdentity>): ReadonlyMap<string, ReadonlySet<string>> {
  return group(
    rows,
    (row) => row.sourceTeamIdentifier,
    (row) => row.providerTeamKey,
  );
}

function identifiersOf(
  rows: ReadonlyArray<TeamIdentity>,
): ReadonlyMap<string, ReadonlySet<string>> {
  return group(
    rows,
    (row) => row.providerTeamKey,
    (row) => row.sourceTeamIdentifier,
  );
}

function claimedIdentifiers(
  claims: ReadonlyArray<TeamClaim>,
): ReadonlyMap<string, ReadonlySet<string>> {
  return group(
    claims,
    (claim) => claim.published.providerTeamKey,
    (claim) => claim.team.identifier,
  );
}

function group<Row>(
  rows: ReadonlyArray<Row>,
  keyOf: (row: Row) => string,
  valueOf: (row: Row) => string,
): ReadonlyMap<string, ReadonlySet<string>> {
  const grouped = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = keyOf(row);
    const values = grouped.get(key) ?? new Set<string>();
    values.add(valueOf(row));
    grouped.set(key, values);
  }
  return grouped;
}

function settledKey(
  keysByIdentifier: ReadonlyMap<string, ReadonlySet<string>>,
  identifiersByKey: ReadonlyMap<string, ReadonlySet<string>>,
  identifier: string,
): string | null {
  const keys = keysByIdentifier.get(identifier);
  if (keys === undefined || keys.size !== 1) {
    return null;
  }
  const key = Array.getUnsafe([...keys], 0);
  const identifiers = identifiersByKey.get(key);
  return identifiers !== undefined && identifiers.size === 1 ? key : null;
}

function uniqueTeams(teams: ReadonlyArray<GameSourceTeam>): ReadonlyArray<GameSourceTeam> {
  const unique = new Map(teams.map((team) => [team.identifier, team]));
  return [...unique.values()];
}
