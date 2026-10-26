import { addExact, exactFromInteger, multiplyExact, parseExact } from "./exact.ts";
import type {
  Exact,
  PeriodCoverage,
  PeriodScore,
  PeriodScoreUnknown,
  ScoringProfile,
  StatId,
  StatObservation,
} from "./types.ts";

export function scorePeriod(
  profile: ScoringProfile,
  observations: ReadonlyArray<StatObservation>,
): PeriodScore {
  requireUniqueObservations(observations);
  const values = new Map(
    observations.map((observation) => [String(observation.statId), observation.value]),
  );
  const ruleIds = new Set(profile.rules.map((rule) => rule.statId));
  const scored: Array<StatId> = [];
  const absent: Array<StatId> = [];
  const unknown: Array<StatId> = [];
  const reasons: Array<PeriodScoreUnknown> = [];
  let total = exactFromInteger(0n);

  for (const rule of profile.rules) {
    const value = values.get(rule.statId);
    if (value === undefined) {
      absent.push(rule.statId);
      continue;
    }
    if (value === null) {
      unknown.push(rule.statId);
      reasons.push({ kind: "value-unknown", statId: rule.statId });
      continue;
    }
    scored.push(rule.statId);
    total = addExact(total, multiplyExact(exactStatValue(value), rule.points));
  }

  const coverage: PeriodCoverage = {
    scored,
    absent,
    unknown,
    unscored: observations
      .map((observation) => String(observation.statId))
      .filter((statId) => !ruleIds.has(statId)),
  };

  if (observations.length === 0) {
    return { kind: "unknown", reasons: [{ kind: "no-observations" }], coverage };
  }
  if (reasons.length > 0) {
    return { kind: "unknown", reasons, coverage };
  }
  return { kind: "scored", points: total, coverage };
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
