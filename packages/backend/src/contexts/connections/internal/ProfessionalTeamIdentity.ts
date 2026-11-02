import { Array } from "effect";

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
