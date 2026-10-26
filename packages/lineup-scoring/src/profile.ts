import { parseExact } from "./exact.ts";
import type {
  ScoringCategory,
  ScoringCoverage,
  ScoringProfile,
  ScoringRule,
  StatId,
} from "./types.ts";

export type ScoringProfileInput = {
  readonly categories: ReadonlyArray<{ readonly statId: number | string; readonly label: string }>;
  readonly rules: ReadonlyArray<{ readonly statId: number | string; readonly points: string }>;
};

export function scoringProfile(input: ScoringProfileInput): ScoringProfile {
  const categories = input.categories.map((category): ScoringCategory => ({
    statId: String(category.statId),
    label: category.label,
  }));
  const rules = input.rules.map((rule): ScoringRule => ({
    statId: String(rule.statId),
    points: parseExact(rule.points),
  }));
  requireUniqueStatIds(
    categories.map((category) => category.statId),
    "category",
  );
  requireUniqueStatIds(
    rules.map((rule) => rule.statId),
    "scoring rule",
  );
  return {
    categories,
    rules,
    scale: rules.reduce((scale, rule) => Math.max(scale, rule.points.scale), 0),
  };
}

export function describeScoring(
  profile: ScoringProfile,
  observedStatIds: ReadonlyArray<StatId>,
): ScoringCoverage {
  const observed = new Set(observedStatIds);
  const ruleIds = new Set(profile.rules.map((rule) => rule.statId));
  const categoryIds = new Set(profile.categories.map((category) => category.statId));
  return {
    scored: sortedStatIds([...observed].filter((statId) => ruleIds.has(statId))),
    unscored: sortedStatIds([...observed].filter((statId) => !ruleIds.has(statId))),
    unusedRules: sortedStatIds([...ruleIds].filter((statId) => !observed.has(statId))),
    rulesWithoutCategory: sortedStatIds([...ruleIds].filter((statId) => !categoryIds.has(statId))),
    categoriesWithoutRule: sortedStatIds([...categoryIds].filter((statId) => !ruleIds.has(statId))),
  };
}

function requireUniqueStatIds(statIds: ReadonlyArray<StatId>, subject: string): void {
  const seen = new Set<StatId>();
  for (const statId of statIds) {
    if (seen.has(statId)) {
      throw new Error(`Duplicate ${subject} for stat ${statId}.`);
    }
    seen.add(statId);
  }
}

function sortedStatIds(statIds: ReadonlyArray<StatId>): ReadonlyArray<StatId> {
  return [...statIds].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}
