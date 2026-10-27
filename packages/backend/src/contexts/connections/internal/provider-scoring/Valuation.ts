import { exactToUnits } from "./Exact.ts";
import type { Exact } from "./Exact.ts";
import { periodsEqual } from "./Period.ts";
import type {
  AvailabilityAssessment,
  Period,
  PolicyPlayer,
  StartingLineup,
  StartingLineupRule,
} from "./types.ts";

export function assessAvailability(player: PolicyPlayer, period: Period): AvailabilityAssessment {
  if (!hasGame(player, period)) {
    return { tier: "not-scheduled", fact: "no-game", period };
  }
  return statusAssessment(player);
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

function statusAssessment(player: PolicyPlayer): AvailabilityAssessment {
  switch (player.availability.kind) {
    case "available":
      return startingAssessment(player.startingLineup, player.startingLineupRule);
    case "uncertain":
      return { tier: "might-play", fact: "uncertain-status", code: player.availability.code };
    case "unrecognised":
      return { tier: "might-play", fact: "unrecognised-status", code: player.availability.code };
    case "excluded":
      return { tier: "will-not-play", fact: "excluded", reason: player.availability.reason };
  }
}

function startingAssessment(
  lineup: StartingLineup,
  rule: StartingLineupRule,
): AvailabilityAssessment {
  switch (lineup) {
    case "confirmed-starting":
      return { tier: "confirmed-start", fact: "confirmed-start" };
    case "confirmed-not-starting":
      return rule === "unlikely-to-play"
        ? { tier: "unlikely-to-play", fact: "confirmed-not-starting" }
        : { tier: "will-play", fact: "available" };
    case "unconfirmed":
      return { tier: "will-play", fact: "available" };
  }
}
