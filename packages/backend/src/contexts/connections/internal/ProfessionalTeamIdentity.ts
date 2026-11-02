import { Array } from "effect";

import type { FantasyLeague } from "#contexts/connections/FantasyTeam.ts";
import type { GameSourceTeam } from "#contexts/connections/GameSource.ts";

import { matchProfessionalTeam } from "./ProfessionalTeamMap.ts";
import type { TeamIdentity } from "./ScheduleObservationRepository.ts";

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

export function resolveProfessionalTeams(input: {
  readonly league: FantasyLeague;
  readonly teams: ReadonlyArray<GameSourceTeam>;
}): ReadonlyMap<string, string | null> {
  const resolved = new Map<string, string | null>();
  for (const team of input.teams) {
    if (resolved.has(team.identifier)) {
      continue;
    }
    const match = matchProfessionalTeam({
      league: input.league,
      identifier: team.identifier,
      abbreviation: team.abbreviation,
      name: team.name,
    });
    resolved.set(team.identifier, match.kind === "mapped" ? match.providerTeamKey : null);
  }
  return resolved;
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
