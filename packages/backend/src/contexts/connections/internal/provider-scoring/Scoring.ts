import { addExact, exactFromInteger, multiplyExact, parseExact } from "./Exact.ts";
import type { Exact } from "./Exact.ts";
import type { ScoringProfile, StatObservation } from "./types.ts";

export function scorePeriod(
  profile: ScoringProfile,
  observations: ReadonlyArray<StatObservation>,
): Exact | undefined {
  requireUniqueObservations(observations);
  if (observations.length === 0) {
    return undefined;
  }

  const values = new Map(
    observations.map((observation) => [String(observation.statId), observation.value]),
  );
  let total = exactFromInteger(0n);

  for (const rule of profile.rules) {
    const value = values.get(rule.statId);
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      return undefined;
    }
    total = addExact(total, multiplyExact(exactStatValue(value), rule.points));
  }

  return total;
}

function exactStatValue(value: string | number): Exact {
  return parseExact(typeof value === "number" ? String(value) : value);
}

function requireUniqueObservations(observations: ReadonlyArray<StatObservation>): void {
  const seen = new Set<string>();
  for (const observation of observations) {
    const statId = String(observation.statId);
    if (seen.has(statId)) {
      throw new Error(`Duplicate observation for stat ${statId}.`);
    }
    seen.add(statId);
  }
}
