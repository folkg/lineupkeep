import { makeAvailabilityTier, knownSelection, unusableSelection } from "@lineupkeep/lineup-solver";
import type {
  AvailabilityTier,
  PlayerId,
  PositionType,
  RosterPlayer,
  RosterSlot,
  SlotEligibility,
} from "@lineupkeep/lineup-solver";

import { containsPeriod, periodKey, periodsEqual } from "./period.ts";
import { resolveValueSource } from "./source.ts";
import type {
  LineupPolicyInput,
  LineupPolicyResult,
  Period,
  PlayerValuation,
  PolicyPlayer,
  ValueSource,
} from "./types.ts";
import { assessAvailability } from "./valuation.ts";

export const lineupPolicyVersion = "value-source-ladder/1";

export const availabilityLadder: ReadonlyArray<AvailabilityTier> = [
  makeAvailabilityTier("will-play"),
  makeAvailabilityTier("might-play"),
  makeAvailabilityTier("will-not-play"),
];

export function buildLineupProblem(input: LineupPolicyInput): LineupPolicyResult {
  requireConsistentInput(input);
  const source = input.source;
  if (source === undefined) {
    return { kind: "refusal", refusal: { kind: "no-value-source" } };
  }
  if (source.kind === "scoring-rules" && source.window.length === 0) {
    return {
      kind: "refusal",
      refusal: { kind: "no-observed-periods", window: source.window },
    };
  }

  const resolved = resolveValueSource({ source, period: input.period });
  const evaluated = input.players.map((player) => {
    const { assessment, units } = resolved.valueOf(player);
    const valuation: PlayerValuation = {
      playerId: player.id,
      availability: assessAvailability(player, input.period),
      selection:
        units === undefined
          ? unusableSelection(resolved.basis, "missing")
          : knownSelection(resolved.basis, units),
      value: assessment,
    };
    return { player: rosterPlayer(player, valuation, input.slots), valuation };
  });

  return {
    kind: "problem",
    problem: {
      selectionBasis: resolved.basis,
      availabilityTiers: availabilityLadder,
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
    availabilityTier: makeAvailabilityTier(valuation.availability.tier),
    selection: valuation.selection,
    reserveEligible: reserveEligible(player, slots),
    lockedSlotId: player.locked ? player.currentSlotId : undefined,
    currentSlotId: player.currentSlotId,
  };
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
  if (input.source !== undefined) {
    requireConsistentSource(input.source, input.period, playerIds);
  }
}

function requireConsistentSource(
  source: ValueSource,
  period: Period,
  playerIds: ReadonlySet<PlayerId>,
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
        if (!containsPeriod(source.window, observation.period)) {
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

function requireUniqueIds(ids: ReadonlyArray<PlayerId>, subject: string): void {
  const seen = new Set<PlayerId>();
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
