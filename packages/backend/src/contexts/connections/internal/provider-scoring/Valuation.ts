import { exactToUnits } from "./Exact.ts";
import type { Exact } from "./Exact.ts";
import { periodsEqual } from "./Period.ts";
import type { AvailabilityAssessment, Period, PlayerAvailability, PolicyPlayer } from "./types.ts";

export function assessAvailability(player: PolicyPlayer, period: Period): AvailabilityAssessment {
  if (!hasGame(player, period)) {
    return { tier: "not-scheduled", fact: "no-game", period };
  }
  return statusAssessment(player.availability);
}

export function selectionUnits(points: Exact, scale: number): number {
  const units = Number(exactToUnits(points, scale));
  if (!Number.isSafeInteger(units)) {
    throw new Error(`Selection value ${String(units)} is not a safe integer.`);
  }
  return units;
}

function hasGame(player: PolicyPlayer, period: Period): boolean {
  return (
    player.scheduled && !player.nonGamePeriods.some((candidate) => periodsEqual(candidate, period))
  );
}

function statusAssessment(availability: PlayerAvailability): AvailabilityAssessment {
  switch (availability.kind) {
    case "available":
      return { tier: "will-play", fact: "available" };
    case "uncertain":
      return { tier: "might-play", fact: "uncertain-status", code: availability.code };
    case "unrecognised":
      return { tier: "might-play", fact: "unrecognised-status", code: availability.code };
    case "excluded":
      return { tier: "will-not-play", fact: "excluded", reason: availability.reason };
  }
}
