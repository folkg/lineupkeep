import { averageExact, exactToUnits, scorePeriod } from "@lineupkeep/lineup-scoring";
import type { Exact, ScoringProfile, StatObservation } from "@lineupkeep/lineup-scoring";
import { knownSelection } from "@lineupkeep/lineup-solver";
import type { PlayerId, SelectionBasis } from "@lineupkeep/lineup-solver";

import { containsPeriod, periodsEqual } from "./period.ts";
import type {
  AvailabilityAssessment,
  Period,
  PlayerAvailability,
  PlayerValuation,
  PolicyPlayer,
} from "./types.ts";

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
  const units = average === undefined ? 0 : selectionUnits(average, input.scoring.scale);

  return {
    playerId: input.player.id,
    availability: assessAvailability(input.player, input.period),
    countedPeriods,
    skippedPeriods,
    periodPoints,
    average,
    selection: knownSelection(input.selectionBasis, units),
  };
}

export function assessAvailability(player: PolicyPlayer, period: Period): AvailabilityAssessment {
  if (!hasGame(player, period)) {
    return { tier: "will-not-play", fact: "no-game", period };
  }
  return statusAssessment(player.availability);
}

function hasGame(player: PolicyPlayer, period: Period): boolean {
  return !player.nonGamePeriods.some((candidate) => periodsEqual(candidate, period));
}

function statusAssessment(availability: PlayerAvailability): AvailabilityAssessment {
  switch (availability.kind) {
    case "available":
      return { tier: "will-play", fact: "available" };
    case "uncertain":
      return { tier: "might-play", fact: "day-to-day" };
    case "unrecognised":
      return { tier: "might-play", fact: "unrecognised-status", code: availability.code };
    case "excluded":
      return { tier: "will-not-play", fact: "excluded", reason: availability.reason };
  }
}

function selectionUnits(points: Exact, scale: number): number {
  const units = Number(exactToUnits(points, scale));
  if (!Number.isSafeInteger(units)) {
    throw new Error(`Selection value ${String(units)} is not a safe integer.`);
  }
  return units;
}
