import { periodKey, periodsEqual } from "./Period.ts";
import type {
  AvailabilityTier,
  Period,
  PolicyPlayer,
  ValueSource,
  ValueSourceKind,
} from "./types.ts";
import { assessAvailability } from "./Valuation.ts";
import { resolveValueSource, valueSourceLadder } from "./ValueSource.ts";

const noValueSourceRefusal = {
  code: "policy:no-value-source",
  detail:
    "This league publishes no value source the custom policy can use, so its lineup cannot be valued.",
} as const;

const emptySourceRefusals: Readonly<
  Record<ValueSourceKind, { readonly code: string; readonly detail: string }>
> = {
  projection: {
    code: "policy:no-projection",
    detail:
      "Your league published no projected rank for any player on this roster for this period, so the custom policy cannot value the lineup.",
  },
  "community-start-rate": {
    code: "policy:no-start-rate",
    detail:
      "Your league published no started percentage for any player on this roster, so the custom policy cannot value the lineup.",
  },
  "ownership-composite": {
    code: "policy:no-ownership-facts",
    detail:
      "Your league published no ownership facts for any player on this roster, so the custom policy cannot value the lineup.",
  },
};

export function scoreLineup(input: LineupScoreInput): LineupScoreResult {
  requireConsistentInput(input);
  const sources = orderedSources(input.sources);
  for (const source of sources) {
    const resolved = resolveValueSource({ source, period: input.period });
    const units = input.players.map((player) => resolved.unitsOf(player));
    if (units.every((unit) => unit === undefined)) {
      continue;
    }
    return {
      kind: "scored",
      label: resolved.label,
      players: input.players.map((player, index) => ({
        id: player.id,
        availability: assessAvailability(player, input.period),
        units: units[index],
      })),
    };
  }
  const weakest = sources[sources.length - 1];
  if (weakest === undefined) {
    return {
      kind: "refused",
      refusal: "structural",
      code: noValueSourceRefusal.code,
      detail: noValueSourceRefusal.detail,
    };
  }
  const refusal = emptySourceRefusals[weakest.kind];
  return { kind: "refused", refusal: "transient", code: refusal.code, detail: refusal.detail };
}

function orderedSources(sources: ReadonlyArray<ValueSource>): ReadonlyArray<ValueSource> {
  return [...sources].sort(
    (left, right) => valueSourceLadder.indexOf(left.kind) - valueSourceLadder.indexOf(right.kind),
  );
}

function requireConsistentInput(input: LineupScoreInput): void {
  const playerIds = new Set(input.players.map((player) => player.id));
  if (playerIds.size !== input.players.length) {
    throw new Error("A policy roster must not contain the same player twice.");
  }
  for (const source of input.sources) {
    requireConsistentSource(source, input.period);
  }
}

function requireConsistentSource(source: ValueSource, period: Period): void {
  switch (source.kind) {
    case "projection": {
      if (!periodsEqual(source.period, period)) {
        throw new Error(
          `A projection for ${periodKey(source.period)} cannot price a lineup for ${periodKey(period)}.`,
        );
      }
      requireUniqueIds(
        source.players.map((entry) => entry.id),
        "projection",
      );
      for (const player of source.players) {
        if (!Number.isSafeInteger(player.rank) || player.rank < 1) {
          throw new Error(
            `A projected rank must be a positive integer, received ${String(player.rank)}.`,
          );
        }
      }
      return;
    }
    case "community-start-rate": {
      requireUniqueIds(
        source.started.map((entry) => entry.id),
        "started percentage",
      );
      return;
    }
    case "ownership-composite": {
      requireUniqueIds(
        source.players.map((entry) => entry.id),
        "ownership facts",
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

export type LineupScoreInput = {
  readonly period: Period;
  readonly sources: ReadonlyArray<ValueSource>;
  readonly players: ReadonlyArray<PolicyPlayer>;
};

export type ScoredPlayer = {
  readonly id: string;
  readonly availability: AvailabilityTier;
  readonly units: number | undefined;
};

export type LineupScoreResult =
  | {
      readonly kind: "scored";
      readonly label: string;
      readonly players: ReadonlyArray<ScoredPlayer>;
    }
  | {
      readonly kind: "refused";
      readonly refusal: "structural" | "transient";
      readonly code: string;
      readonly detail: string;
    };
