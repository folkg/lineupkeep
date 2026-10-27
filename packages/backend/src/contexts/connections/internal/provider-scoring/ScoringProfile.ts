import { parseExact } from "./Exact.ts";
import type { ScoringCategory, ScoringProfile, ScoringRule, StatId } from "./types.ts";

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

function requireUniqueStatIds(statIds: ReadonlyArray<StatId>, subject: string): void {
  const seen = new Set<StatId>();
  for (const statId of statIds) {
    if (seen.has(statId)) {
      throw new Error(`Duplicate ${subject} for stat ${statId}.`);
    }
    seen.add(statId);
  }
}
