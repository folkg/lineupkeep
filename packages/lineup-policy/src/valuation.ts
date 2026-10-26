import {
  averageExact,
  exactFromInteger,
  exactToUnits,
  multiplyExact,
  parseExact,
  scorePeriod,
} from "@lineupkeep/lineup-scoring";
import type { Exact, ScoringProfile, StatObservation } from "@lineupkeep/lineup-scoring";
import { knownSelection, unusableSelection } from "@lineupkeep/lineup-solver";
import type { PlayerId, SelectionBasis } from "@lineupkeep/lineup-solver";

import { containsPeriod, periodsEqual } from "./period.ts";
import type { Period, PlayerValuation, PolicyPlayer, ValuationEffect } from "./types.ts";

export const dayToDayFactor = parseExact("0.5");

export function valuate(input: {
  readonly player: PolicyPlayer;
  readonly selectionBasis: SelectionBasis;
  readonly scoring: ScoringProfile;
  readonly window: ReadonlyArray<Period>;
  readonly period: Period;
  readonly statsFor: (
    playerId: PlayerId,
    period: Period,
  ) => ReadonlyArray<StatObservation> | undefined;
}): PlayerValuation {
  const countedPeriods: Array<Period> = [];
  const skippedPeriods: Array<Period> = [];
  const periodPoints: Array<Exact> = [];

  for (const windowPeriod of input.window) {
    if (containsPeriod(input.player.nonGamePeriods, windowPeriod)) {
      skippedPeriods.push(windowPeriod);
      continue;
    }
    const stats = input.statsFor(input.player.id, windowPeriod);
    if (stats === undefined) {
      skippedPeriods.push(windowPeriod);
      continue;
    }
    const score = scorePeriod(input.scoring, stats);
    if (score.kind === "unknown") {
      skippedPeriods.push(windowPeriod);
      continue;
    }
    countedPeriods.push(windowPeriod);
    periodPoints.push(score.points);
  }

  const average =
    periodPoints.length === 0 ? undefined : averageExact(periodPoints, input.scoring.scale);
  const effect = valuationEffect(input.player, input.period);
  const evidence = {
    playerId: input.player.id,
    effect,
    countedPeriods,
    skippedPeriods,
    periodPoints,
    average,
  };

  const unusable = (reason: "missing" | "not-comparable"): PlayerValuation => ({
    ...evidence,
    selection: unusableSelection(input.selectionBasis, reason),
  });
  const known = (points: Exact): PlayerValuation => ({
    ...evidence,
    selection: knownSelection(input.selectionBasis, selectionUnits(points, input.scoring.scale)),
  });

  if (effect.kind === "excluded" || effect.kind === "no-game") {
    return known(exactFromInteger(0n));
  }
  if (effect.kind === "unknown-availability") {
    return unusable("not-comparable");
  }
  if (average === undefined) {
    return unusable("missing");
  }
  if (effect.kind === "day-to-day") {
    return known(multiplyExact(average, effect.factor));
  }
  return known(average);
}

function valuationEffect(player: PolicyPlayer, period: Period): ValuationEffect {
  if (player.availability.kind === "excluded") {
    return { kind: "excluded", reason: player.availability.reason };
  }
  if (player.nonGamePeriods.some((candidate) => periodsEqual(candidate, period))) {
    return { kind: "no-game", period };
  }
  if (player.availability.kind === "unknown") {
    return { kind: "unknown-availability", code: player.availability.code };
  }
  if (player.availability.kind === "uncertain") {
    return { kind: "day-to-day", factor: dayToDayFactor };
  }
  return { kind: "period-average" };
}

function selectionUnits(points: Exact, scale: number): number {
  const units = Number(exactToUnits(points, scale));
  if (!Number.isSafeInteger(units)) {
    throw new Error(`Selection value ${String(units)} is not a safe integer.`);
  }
  return units;
}
