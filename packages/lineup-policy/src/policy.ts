import type { StatObservation } from "@lineupkeep/lineup-scoring";
import type {
  PlayerId,
  PositionType,
  RosterPlayer,
  RosterSlot,
  SlotEligibility,
  SlotId,
} from "@lineupkeep/lineup-solver";

import { containsPeriod, periodKey, periodsEqual } from "./period.ts";
import type {
  LineupPolicyInput,
  LineupPolicyResult,
  Period,
  PeriodObservation,
  PlayerValuation,
  PolicyPlayer,
} from "./types.ts";
import { valuate } from "./valuation.ts";

export const lineupPolicyVersion = "trailing-mean-points/1";

export function buildLineupProblem(input: LineupPolicyInput): LineupPolicyResult {
  requireConsistentInput(input);
  if (input.scoring.rules.length === 0) {
    return { kind: "refusal", refusal: { kind: "no-scoring-rules" } };
  }
  if (input.window.length === 0) {
    return { kind: "refusal", refusal: { kind: "no-observed-periods", window: input.window } };
  }

  const stats = observationIndex(input.observations);
  const statsFor = (
    playerId: PlayerId,
    period: Period,
  ): ReadonlyArray<StatObservation> | undefined => stats.get(observationKey(period, playerId));

  const evaluated = input.players.map((player) => {
    const valuation = valuate({
      player,
      selectionBasis: input.selectionBasis,
      scoring: input.scoring,
      window: input.window,
      period: input.period,
      statsFor,
    });
    return { player: rosterPlayer(player, valuation, input.slots), valuation };
  });

  return {
    kind: "problem",
    problem: {
      selectionBasis: input.selectionBasis,
      slots: input.slots,
      players: evaluated.map((entry) => entry.player),
    },
    valuations: evaluated.map((entry) => entry.valuation),
  };
}

function rosterPlayer(
  player: PolicyPlayer,
  valuation: PlayerValuation,
  slots: ReadonlyArray<RosterSlot>,
): RosterPlayer {
  return {
    id: player.id,
    eligiblePositions: player.eligiblePositions,
    selection: valuation.selection,
    reserveEligible: reserveEligible(player, slots),
    lockedSlotId: lockedSlotId(player, valuation),
    currentSlotId: player.currentSlotId,
  };
}

function lockedSlotId(player: PolicyPlayer, valuation: PlayerValuation): SlotId | undefined {
  if (valuation.effect.kind === "unknown-availability") {
    return player.currentSlotId;
  }
  return player.locked ? player.currentSlotId : undefined;
}

function reserveEligible(player: PolicyPlayer, slots: ReadonlyArray<RosterSlot>): boolean {
  return slots.some(
    (slot) => slot.kind === "reserve" && slotAccepts(slot.eligibility, player.eligiblePositions),
  );
}

function slotAccepts(
  eligibility: SlotEligibility,
  positions: ReadonlyArray<PositionType>,
): boolean {
  return (
    eligibility.kind === "any" ||
    eligibility.positions.some((position) => positions.includes(position))
  );
}

function requireConsistentInput(input: LineupPolicyInput): void {
  if (input.window.some((period) => periodsEqual(period, input.period))) {
    throw new Error("The target period cannot belong to its own observation window.");
  }
  requireUniquePeriods(input.window, "observation window");
  requireUniquePeriods(
    input.observations.map((observation) => observation.period),
    "observation period",
  );
  const playerIds = new Set(input.players.map((player) => player.id));
  if (playerIds.size !== input.players.length) {
    throw new Error("A policy roster must not contain the same player twice.");
  }
  const slotIds = new Set(input.slots.map((slot) => slot.id));
  if (slotIds.size !== input.slots.length) {
    throw new Error("A policy problem must not contain the same slot twice.");
  }
  for (const player of input.players) {
    if (!slotIds.has(player.currentSlotId)) {
      throw new Error(
        `Player ${player.id} currently occupies slot ${player.currentSlotId}, which the league does not declare.`,
      );
    }
  }
  for (const observation of input.observations) {
    if (!containsPeriod(input.window, observation.period)) {
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
      throw new Error(`Observation period ${periodKey(observation.period)} lists a player twice.`);
    }
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

function observationIndex(
  observations: ReadonlyArray<PeriodObservation>,
): Map<string, ReadonlyArray<StatObservation>> {
  const index = new Map<string, ReadonlyArray<StatObservation>>();
  for (const observation of observations) {
    for (const entry of observation.players) {
      index.set(observationKey(observation.period, entry.id), entry.stats);
    }
  }
  return index;
}

function observationKey(period: Period, playerId: PlayerId): string {
  return `${periodKey(period)}|${playerId}`;
}
