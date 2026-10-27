import { periodKey, periodsEqual } from "./Period.ts";
import type {
  AvailabilityAssessment,
  Period,
  PolicyPlayer,
  ValueAssessment,
  ValueSource,
  ValueSourceKind,
} from "./types.ts";
import { assessAvailability } from "./Valuation.ts";
import { resolveValueSource, valueSourceLadder } from "./ValueSource.ts";

const noValueSourceRefusalCode = "policy:no-value-source" as const;
const noValueSourceRefusalDetail =
  "This league publishes no value source the custom policy can use, so its lineup cannot be valued.";

const noObservedPeriodsRefusalCode = "policy:no-observed-periods" as const;
const noObservedPeriodsRefusalDetail =
  "No completed scoring period is available to value the roster, so the custom policy cannot plan a lineup.";

export function scoreLineup(input: LineupScoreInput): LineupScoreResult {
  requireConsistentInput(input);
  const refusals: Array<LineupScoreRefusal> = [];
  for (const source of orderedSources(input.sources)) {
    if (source.kind === "scoring-rules" && source.window.length === 0) {
      refusals.push({
        refusal: "transient",
        code: noObservedPeriodsRefusalCode,
        detail: noObservedPeriodsRefusalDetail,
      });
      continue;
    }
    const resolved = resolveValueSource({ source, period: input.period });
    return {
      kind: "scored",
      label: resolved.label,
      players: input.players.map((player) => {
        const { assessment, units } = resolved.valueOf(player);
        return {
          id: player.id,
          availability: assessAvailability(player, input.period),
          units,
          value: assessment,
        };
      }),
    };
  }
  return {
    kind: "refused",
    ...(refusals.at(-1) ?? {
      refusal: "structural" as const,
      code: noValueSourceRefusalCode,
      detail: noValueSourceRefusalDetail,
    }),
  };
}

function orderedSources(sources: ReadonlyArray<ValueSource>): ReadonlyArray<ValueSource> {
  return [...sources].sort(
    (left, right) =>
      valueSourceLadder.indexOf(sourceKind(left)) - valueSourceLadder.indexOf(sourceKind(right)),
  );
}

function sourceKind(source: ValueSource): ValueSourceKind {
  return source.kind;
}

function requireConsistentInput(input: LineupScoreInput): void {
  const playerIds = new Set(input.players.map((player) => player.id));
  if (playerIds.size !== input.players.length) {
    throw new Error("A policy roster must not contain the same player twice.");
  }
  for (const source of input.sources) {
    requireConsistentSource(source, input.period, playerIds);
  }
}

function requireConsistentSource(
  source: ValueSource,
  period: Period,
  playerIds: ReadonlySet<string>,
): void {
  switch (source.kind) {
    case "scoring-rules": {
      requireUniquePeriods(source.window, "observation window");
      if (source.window.some((candidate) => periodsEqual(candidate, period))) {
        throw new Error("The target period cannot belong to its own observation window.");
      }
      requireUniquePeriods(
        source.observations.map((observation) => observation.period),
        "observation period",
      );
      for (const observation of source.observations) {
        if (!source.window.some((candidate) => periodsEqual(candidate, observation.period))) {
          throw new Error(
            `Observation period ${periodKey(observation.period)} is outside the declared window.`,
          );
        }
        for (const entry of observation.players) {
          if (!playerIds.has(entry.id)) {
            throw new Error(`Observation for player ${entry.id} is not on the policy roster.`);
          }
        }
        const observed = new Set(observation.players.map((entry) => entry.id));
        if (observed.size !== observation.players.length) {
          throw new Error(
            `Observation period ${periodKey(observation.period)} lists a player twice.`,
          );
        }
      }
      return;
    }
    case "projected-points": {
      requireUniqueIds(
        source.projections.map((entry) => entry.id),
        "projection",
      );
      requireUniqueIds(
        source.realised.map((entry) => entry.id),
        "realised total",
      );
      return;
    }
    case "community-start-rate": {
      requireUniqueIds(
        source.started.map((entry) => entry.id),
        "started percentage",
      );
      return;
    }
  }
}

function requireUniqueIds(ids: ReadonlyArray<string>, subject: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      throw new Error(`Duplicate ${subject} for player ${id}.`);
    }
    seen.add(id);
  }
}

function requireUniquePeriods(periods: ReadonlyArray<Period>, subject: string): void {
  const seen = new Set<string>();
  for (const period of periods) {
    const key = periodKey(period);
    if (seen.has(key)) {
      throw new Error(`Duplicate ${subject} ${key}.`);
    }
    seen.add(key);
  }
}

export type LineupScoreInput = {
  readonly period: Period;
  readonly sources: ReadonlyArray<ValueSource>;
  readonly players: ReadonlyArray<PolicyPlayer>;
};

export type ScoredPlayer = {
  readonly id: string;
  readonly availability: AvailabilityAssessment;
  readonly units: number | undefined;
  readonly value: ValueAssessment;
};

export type LineupScoreResult =
  | {
      readonly kind: "scored";
      readonly label: string;
      readonly players: ReadonlyArray<ScoredPlayer>;
    }
  | {
      readonly kind: "refused";
      readonly refusal: LineupScoreRefusal["refusal"];
      readonly code: string;
      readonly detail: string;
    };

type LineupScoreRefusal = {
  readonly refusal: "structural" | "transient";
  readonly code: string;
  readonly detail: string;
};
