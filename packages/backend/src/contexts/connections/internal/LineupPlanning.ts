import {
  knownSelection,
  makeAvailabilityTier,
  makePlayerId,
  makeSelectionBasis,
  makeSlotId,
  solveLineup,
  unusableSelection,
} from "@lineupkeep/lineup-solver";
import type {
  AvailabilityTier,
  LineupAssignment,
  LineupRefusal,
  PlayerSelection,
  RosterPlayer,
  RosterSlot,
  SelectionBasis,
  SlotEligibility,
} from "@lineupkeep/lineup-solver";

import type { LineupLeftInPlacePlayer } from "#contexts/connections/LineupRun.ts";
import type {
  ProviderGamesPlayed,
  ProviderLeagueSettings,
  ProviderLineupAssignment,
  ProviderPlayerScore,
  ProviderRoster,
  ProviderRosterPosition,
} from "#contexts/connections/Provider.ts";

const selectionBasis: SelectionBasis = makeSelectionBasis("provider-score");

const gamesBuffer = 1.015;

const availabilityLadder: ReadonlyArray<AvailabilityTier> = [
  makeAvailabilityTier("confirmed-start"),
  makeAvailabilityTier("will-play"),
  makeAvailabilityTier("might-play"),
  makeAvailabilityTier("unlikely-to-play"),
  makeAvailabilityTier("will-not-play"),
  makeAvailabilityTier("not-scheduled"),
];

export function planAssignments(input: PlanAssignmentsInput): PlanAssignmentsResult {
  const limits = new Map(input.gamesPlayed.map((entry) => [entry.position, entry]));
  const lockedBySlot = lockedCounts(input.roster);
  const slots = input.league.rosterPositions.flatMap((position) =>
    rosterSlots(position, limits, lockedBySlot.get(position.position) ?? 0),
  );
  const values = new Map(input.values.map((value) => [value.providerPlayerKey, value]));
  const leftInPlace = playersLeftInPlace(input.roster, slots);
  const solved = solveLineup({
    selectionBasis,
    availabilityTiers: availabilityLadder,
    slots,
    players: solverPlayers(input.roster.players, values, slots),
  });
  if (solved.kind === "plan") {
    return {
      kind: "planned",
      assignments: assignments(input.roster, solved.plan.assignments),
      leftInPlace: [],
    };
  }

  if (leftInPlace.length === 0) {
    return { kind: "refused", detail: solverRefusalDetail(solved.refusal) };
  }
  const leftInPlaceKeys = new Set(leftInPlace.map((held) => held.player.providerPlayerKey));
  const remainingSlots = slotsWithoutLeftInPlace(slots, leftInPlace);
  const remaining = solveLineup({
    selectionBasis,
    availabilityTiers: availabilityLadder,
    slots: remainingSlots,
    players: solverPlayers(
      input.roster.players.filter((player) => !leftInPlaceKeys.has(player.providerPlayerKey)),
      values,
      remainingSlots,
    ),
  });
  if (remaining.kind === "refusal") {
    return { kind: "refused", detail: solverRefusalDetail(solved.refusal) };
  }
  return {
    kind: "planned",
    assignments: assignments(input.roster, remaining.plan.assignments),
    leftInPlace: leftInPlace.map((held) => ({
      name: held.player.name,
      slot: held.slot,
      reason: held.reason,
    })),
  };
}

function assignments(
  roster: ProviderRoster,
  planned: ReadonlyArray<LineupAssignment>,
): ReadonlyArray<ProviderLineupAssignment> {
  const plannedSlots = new Map(
    planned.map((assignment) => [String(assignment.playerId), String(assignment.slotId)]),
  );
  const changed: Array<ProviderLineupAssignment> = [];
  for (const player of roster.players) {
    if (player.slot.status !== "verified") {
      continue;
    }
    const targetSlot = plannedSlots.get(player.providerPlayerKey);
    if (targetSlot === undefined || targetSlot === player.slot.slot) {
      continue;
    }
    changed.push({ providerPlayerKey: player.providerPlayerKey, slot: targetSlot });
  }
  return changed;
}

function playersLeftInPlace(
  roster: ProviderRoster,
  slots: ReadonlyArray<RosterSlot>,
): ReadonlyArray<HeldPlayer> {
  return roster.players.flatMap((player) => {
    if (player.slot.status !== "verified") {
      return [];
    }
    const slot = player.slot.slot;
    if (!slots.some((entry) => slotAccepts(entry.eligibility, player.eligiblePositions))) {
      return [
        {
          player,
          slot,
          reason: "No slot in this league's lineup accepts them, so the plan leaves them there.",
        },
      ];
    }
    const current = slots.find((entry) => String(entry.id) === slot);
    return current?.kind === "reserve" &&
      !slotAccepts(current.eligibility, player.eligiblePositions)
      ? [
          {
            player,
            slot,
            reason:
              "The league no longer lists them as eligible for this reserve slot, so the plan leaves them there.",
          },
        ]
      : [];
  });
}

function slotsWithoutLeftInPlace(
  slots: ReadonlyArray<RosterSlot>,
  leftInPlace: ReadonlyArray<HeldPlayer>,
): ReadonlyArray<RosterSlot> {
  const occupied = new Map<string, number>();
  for (const held of leftInPlace) {
    occupied.set(held.slot, (occupied.get(held.slot) ?? 0) + 1);
  }
  return slots.flatMap((slot) => {
    const capacity = slot.capacity - (occupied.get(String(slot.id)) ?? 0);
    return capacity > 0 ? [{ ...slot, capacity }] : [];
  });
}

function solverPlayers(
  members: ProviderRoster["players"],
  values: ReadonlyMap<string, ProviderPlayerScore>,
  slots: ReadonlyArray<RosterSlot>,
): ReadonlyArray<RosterPlayer> {
  return members.flatMap((player) =>
    player.slot.status === "verified"
      ? [rosterPlayer(player, player.slot.slot, values.get(player.providerPlayerKey), slots)]
      : [],
  );
}

function rosterPlayer(
  player: ProviderRoster["players"][number],
  slot: string,
  value: ProviderPlayerScore | undefined,
  slots: ReadonlyArray<RosterSlot>,
): RosterPlayer {
  if (value === undefined) {
    throw new Error("A provider lineup score must cover every roster player.");
  }
  const eligibility = player.eligiblePositions;
  return {
    id: makePlayerId(player.providerPlayerKey),
    eligiblePositions: eligibility,
    availabilityTier: makeAvailabilityTier(value.availability),
    selection: selection(value.score),
    reserveEligible: slots.some(
      (slot) => slot.kind === "reserve" && slotAccepts(slot.eligibility, eligibility),
    ),
    lockedSlotId: player.isEditable === true ? undefined : makeSlotId(slot),
    currentSlotId: slots.some((entry) => String(entry.id) === slot) ? makeSlotId(slot) : undefined,
  };
}

function selection(score: number | null): PlayerSelection {
  return score === null
    ? unusableSelection(selectionBasis, "missing")
    : knownSelection(selectionBasis, score);
}

function lockedCounts(roster: ProviderRoster): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const player of roster.players) {
    if (player.isEditable !== true && player.slot.status === "verified") {
      counts.set(player.slot.slot, (counts.get(player.slot.slot) ?? 0) + 1);
    }
  }
  return counts;
}

function rosterSlots(
  position: ProviderRosterPosition,
  limits: ReadonlyMap<string, ProviderGamesPlayed>,
  locked: number,
): ReadonlyArray<RosterSlot> {
  const id = makeSlotId(position.position);
  const eligibility = slotEligibility(position.eligibility);
  if (position.kind !== "starting") {
    return [{ kind: position.kind, id, capacity: position.count, eligibility }];
  }
  const limit = limits.get(position.position);
  switch (limit === undefined ? "none" : capacityReduction(limit)) {
    case "none":
      return [
        { kind: "starting", id, capacity: position.count, requirement: "required", eligibility },
      ];
    case "one": {
      const capacity = Math.min(Math.max(position.count - 1, locked), position.count);
      return capacity === 0
        ? []
        : [{ kind: "starting", id, capacity, requirement: "optional", eligibility }];
    }
    case "exhausted": {
      const capacity = Math.min(position.count, locked);
      return capacity === 0
        ? []
        : [{ kind: "starting", id, capacity, requirement: "optional", eligibility }];
    }
  }
}

function capacityReduction(limit: ProviderGamesPlayed): "none" | "one" | "exhausted" {
  if (limit.played >= limit.max) {
    return "exhausted";
  }
  return limit.projected > limit.max * gamesBuffer ? "one" : "none";
}

function slotEligibility(positions: ReadonlyArray<string>): SlotEligibility {
  return positions.length === 0
    ? { kind: "any" }
    : { kind: "positions", positions: [...positions] };
}

function slotAccepts(eligibility: SlotEligibility, positions: ReadonlyArray<string>): boolean {
  return (
    eligibility.kind === "any" ||
    eligibility.positions.some((position) => positions.includes(position))
  );
}

function solverRefusalDetail(refusal: LineupRefusal): string {
  switch (refusal.reason) {
    case "unusable-selection-value":
      return "Some roster players have no usable selection value, so a complete lineup cannot be planned.";
    case "lock-references-unknown-slot":
      return "A locked player occupies a slot this league does not declare, so the lineup cannot be planned.";
    case "locked-player-ineligible-for-slot":
      return "A locked player is not eligible for the slot they occupy, so the lineup cannot be planned.";
    case "lock-capacity-exceeded":
      return "Locked players exceed a slot's declared capacity, so the lineup cannot be planned.";
    case "roster-exceeds-slot-capacity":
      return "The roster has more players than the league's declared slots, so the lineup cannot be planned without dropping a player.";
    case "player-has-no-legal-slot":
      return "Some roster players have no legal slot, so the lineup cannot be planned.";
    case "required-starting-position-unfillable":
      return "A required starting position cannot be filled from the current roster.";
    case "no-legal-assignment":
      return "No complete legal assignment of this roster exists.";
  }
}

type HeldPlayer = {
  readonly player: ProviderRoster["players"][number];
  readonly slot: string;
  readonly reason: string;
};

export type PlanAssignmentsInput = {
  readonly league: ProviderLeagueSettings;
  readonly roster: ProviderRoster;
  readonly values: ReadonlyArray<ProviderPlayerScore>;
  readonly gamesPlayed: ReadonlyArray<ProviderGamesPlayed>;
};

export type PlanAssignmentsResult =
  | {
      readonly kind: "planned";
      readonly assignments: ReadonlyArray<ProviderLineupAssignment>;
      readonly leftInPlace: ReadonlyArray<LineupLeftInPlacePlayer>;
    }
  | { readonly kind: "refused"; readonly detail: string };
