import { Array } from "effect";
import { Array as EffectArray } from "effect";

import type { TeamIdentity } from "./ScheduleObservationRepository.ts";
function arrayValueIsArray<A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> {
  return EffectArray.isArray(value);
}

export function uniqueProviderTeamKeys(
  rows: ReadonlyArray<TeamIdentity>,
): ReadonlyMap<string, string> {
  const grouped = group(
    rows,
    (row) => row.sourceTeamIdentifier,
    (row) => row.providerTeamKey,
  );
  return new Map(
    EffectArray.flatMap([...grouped.entries()], ([identifier, keys]) => {
      const flatMapped1 =
        keys.size === 1 ? [[identifier, Array.getUnsafe([...keys], 0)] as const] : [];
      return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
    }),
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
