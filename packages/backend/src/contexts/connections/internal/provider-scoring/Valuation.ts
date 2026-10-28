import { exactToUnits } from "./Exact.ts";
import type { Exact } from "./Exact.ts";
import { periodsEqual } from "./Period.ts";
import type {
  AvailabilityTier,
  Period,
  PolicyPlayer,
  StartingLineup,
  StartingLineupRule,
} from "./types.ts";

export function assessAvailability(player: PolicyPlayer, period: Period): AvailabilityTier {
  if (!hasGame(player, period)) {
    return "not-scheduled";
  }
  return statusTier(player);
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

function statusTier(player: PolicyPlayer): AvailabilityTier {
  switch (player.availability.kind) {
    case "available":
      return startingTier(player.startingLineup, player.startingLineupRule);
    case "uncertain":
    case "unrecognised":
      return "might-play";
    case "excluded":
      return "will-not-play";
  }
}

function startingTier(lineup: StartingLineup, rule: StartingLineupRule): AvailabilityTier {
  switch (lineup) {
    case "confirmed-starting":
      return "confirmed-start";
    case "confirmed-not-starting":
      return rule === "unlikely-to-play" ? "unlikely-to-play" : "will-play";
    case "unconfirmed":
      return "will-play";
  }
}
