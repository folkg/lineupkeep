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
  PlayerId,
  PlayerSelection,
  RosterPlayer,
  RosterSlot,
  SelectionBasis,
  SlotEligibility,
  SlotId,
} from "@lineupkeep/lineup-solver";
import { Array as EffectArray } from "effect";

import type { LineupLeftInPlacePlayer } from "#contexts/connections/LineupRun.ts";
import type {
  ProviderGamesPlayed,
  ProviderLeagueSettings,
  ProviderLineupAssignment,
  ProviderPlayerScore,
  ProviderRoster,
  ProviderRosterPosition,
} from "#contexts/connections/Provider.ts";
import {
  rosterPlayerInjured,
  rosterRuleOf,
  slotCapacity,
  slotPlacement,
} from "#contexts/connections/RosterSlots.ts";
import type {
  RosterPlaceFacts,
  RosterRule,
  RosterSlot as RuleSlot,
} from "#contexts/connections/RosterSlots.ts";
function arrayValueIsArray<A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> {
  return EffectArray.isArray(value);
}

const selectionBasis: SelectionBasis = makeSelectionBasis("provider-score");
const placementBasis: SelectionBasis = makeSelectionBasis("roster-placement");
const placementTier: AvailabilityTier = makeAvailabilityTier("roster-placement");

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
  const rule = rosterRuleOf(input.league.rosterConstraints, input.league.rosterPositions);
  const limits = new Map(EffectArray.map(input.gamesPlayed, (entry) => [entry.position, entry]));
  const lockedBySlot = lockedCounts(input.roster);
  const slots = EffectArray.flatMap(input.league.rosterPositions, (position) => {
    const flatMapped1 = rosterSlots(
      position,
      limits,
      lockedBySlot.get(position.position) ?? 0,
      rule,
    );
    return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
  });
  const values = new Map(
    EffectArray.map(input.values, (value) => [value.providerPlayerKey, value]),
  );
  const solved = solveLineup({
    selectionBasis,
    availabilityTiers: availabilityLadder,
    slots,
    players: solverPlayers(input.roster.players, values, slots, rule),
  });
  if (solved.kind === "refusal") {
    return { kind: "refused", detail: solverRefusalDetail(solved.refusal) };
  }
  return {
    kind: "planned",
    assignments: assignments(input.roster, solved.plan.assignments),
    leftInPlace: leftInPlaceReports(input.roster, slots, rule, solved.plan.leftInPlace),
  };
}

export function planRosterPlacement(input: {
  readonly rule: RosterRule;
  readonly players: ReadonlyArray<RosterPlacementPlayer>;
}): RosterPlacementResult {
  const placement = placementSlots(input.rule, input.players);
  const solved = solveLineup({
    selectionBasis: placementBasis,
    availabilityTiers: [placementTier],
    objective: "places",
    slots: placement.slots,
    players: placementPlayers(input.rule, input.players, placement.idByPosition),
  });
  if (solved.kind === "refusal") {
    return { kind: "refused", detail: solverRefusalDetail(solved.refusal) };
  }
  const placements = new Map(
    EffectArray.map(solved.plan.assignments, (assignment) => {
      const position = placement.positionById.get(assignment.slotId);
      if (position === undefined) {
        throw new Error("A planned placement named an undeclared slot.");
      }
      return [String(assignment.playerId), position] as const;
    }),
  );
  return {
    kind: "planned",
    placements,
    moves: placementMoves(input.players, placements),
  };
}

export function planReserveMoves(input: {
  readonly rule: RosterRule;
  readonly players: ReadonlyArray<RosterPlacementPlayer>;
}): ReadonlyArray<RosterPlacementMove> {
  const placement = planRosterPlacement(input);
  return placement.kind === "refused"
    ? []
    : EffectArray.filter(
        placement.moves,
        (move) =>
          input.rule.byPosition.get(move.fromSlot)?.kind !== "reserve" &&
          input.rule.byPosition.get(move.toSlot)?.kind === "reserve",
      );
}

function placementSlots(
  rule: RosterRule,
  players: ReadonlyArray<RosterPlacementPlayer>,
): {
  readonly slots: ReadonlyArray<RosterSlot>;
  readonly idByPosition: ReadonlyMap<string, SlotId>;
  readonly positionById: ReadonlyMap<string, string>;
} {
  const idByPosition = new Map<string, SlotId>();
  const positionById = new Map<string, string>();
  const slots = EffectArray.map(rule.slots, (slot, index): RosterSlot => {
    const id = placementSlotId(slot, index);
    idByPosition.set(slot.position, id);
    positionById.set(String(id), slot.position);
    const eligibility = slotEligibility(rule, slot);
    switch (slot.kind) {
      case "starting":
        return {
          kind: "starting",
          id,
          capacity: slot.count,
          requirement: rule.startingSlotsMayStandEmpty ? "optional" : "required",
          eligibility,
        };
      case "bench":
        return {
          kind: "bench",
          id,
          capacity: slotCapacity(rule, slot) ?? Math.max(rule.rosterMaximum, slot.count),
          eligibility,
        };
      case "reserve": {
        const occupants = occupiedCount(players, slot.position);
        return {
          kind: "reserve",
          id,
          capacity: slot.count,
          eligibility,
          preferred: true,
          vacant: occupants < slot.count,
        };
      }
    }
  });
  return { slots, idByPosition, positionById };
}

function occupiedCount(players: ReadonlyArray<RosterPlacementPlayer>, position: string): number {
  return EffectArray.filter(players, (player) => player.slot === position).length;
}

function placementSlotId(slot: RuleSlot, index: number): SlotId {
  const rank = slot.kind === "reserve" ? "0" : "1";
  return makeSlotId(`${rank}:${String(index).padStart(4, "0")}:${slot.position}`);
}

function placementPlayers(
  rule: RosterRule,
  players: ReadonlyArray<RosterPlacementPlayer>,
  idByPosition: ReadonlyMap<string, SlotId>,
): ReadonlyArray<RosterPlayer> {
  return EffectArray.flatMap(players, (player) => {
    const currentSlotId = player.slot === undefined ? undefined : idByPosition.get(player.slot);
    if (currentSlotId === undefined) {
      return [];
    }
    const place = { positions: player.positions, injured: player.injured };
    const lists = reserveSlotIds(rule, place, (position) => requireSlotId(idByPosition, position));
    return [
      {
        id: makePlayerId(player.key),
        eligiblePositions: player.positions,
        availabilityTier: placementTier,
        selection: knownSelection(placementBasis, 0),
        reserveEligible: lists.length > 0,
        reserveSlotIds: lists,
        lockedSlotId: player.editable ? undefined : currentSlotId,
        currentSlotId,
        mayBeLeftInPlace: false,
      },
    ];
  });
}

function placementMoves(
  players: ReadonlyArray<RosterPlacementPlayer>,
  placements: ReadonlyMap<string, string>,
): ReadonlyArray<RosterPlacementMove> {
  return EffectArray.flatMap(players, (player) => {
    const toSlot = placements.get(player.key);
    return toSlot === undefined || player.slot === undefined || toSlot === player.slot
      ? []
      : [
          {
            playerKey: player.key,
            playerName: player.name,
            fromSlot: player.slot,
            toSlot,
          },
        ];
  });
}

function assignments(
  roster: ProviderRoster,
  planned: ReadonlyArray<LineupAssignment>,
): ReadonlyArray<ProviderLineupAssignment> {
  const plannedSlots = new Map(
    EffectArray.map(planned, (assignment) => [
      String(assignment.playerId),
      String(assignment.slotId),
    ]),
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

function leftInPlaceReports(
  roster: ProviderRoster,
  slots: ReadonlyArray<RosterSlot>,
  rule: RosterRule,
  leftInPlace: ReadonlyArray<PlayerId>,
): ReadonlyArray<LineupLeftInPlacePlayer> {
  const left = new Set(EffectArray.map(leftInPlace, String));
  return EffectArray.flatMap(roster.players, (player) => {
    if (player.slot.status !== "verified" || !left.has(player.providerPlayerKey)) {
      return [];
    }
    return [
      {
        name: player.name,
        slot: player.slot.slot,
        reason: leftInPlaceReason(player, slots, rule),
      },
    ];
  });
}

function leftInPlaceReason(
  player: ProviderRoster["players"][number],
  slots: ReadonlyArray<RosterSlot>,
  rule: RosterRule,
): string {
  const place = rosterPlaceOf(player);
  const current =
    player.slot.status === "verified" ? rule.byPosition.get(player.slot.slot) : undefined;
  if (
    current?.kind === "reserve" &&
    rule.reserveEligibility.kind === "injury_status" &&
    !place.injured
  ) {
    return "The league's reserve list only accepts an injured player, and they are no longer injured, so the plan leaves them there.";
  }
  return acceptsSlot(slots, rule, place)
    ? "The league no longer lists them as eligible for this reserve slot, so the plan leaves them there."
    : "No slot in this league's lineup accepts them, so the plan leaves them there.";
}

function acceptsSlot(
  slots: ReadonlyArray<RosterSlot>,
  rule: RosterRule,
  place: { readonly positions: ReadonlyArray<string>; readonly injured: boolean },
): boolean {
  return (
    EffectArray.some(
      slots,
      (slot) => slot.kind !== "reserve" && slotAccepts(slot.eligibility, place.positions),
    ) ||
    EffectArray.some(
      rule.slots,
      (slot) => slot.kind === "reserve" && slotPlacement(rule, slot.position, place).legal === true,
    )
  );
}

function slotAccepts(eligibility: SlotEligibility, positions: ReadonlyArray<string>): boolean {
  return (
    eligibility.kind === "any" ||
    EffectArray.some(eligibility.positions, (position) => positions.includes(position))
  );
}

function solverPlayers(
  members: ProviderRoster["players"],
  values: ReadonlyMap<string, ProviderPlayerScore>,
  slots: ReadonlyArray<RosterSlot>,
  rule: RosterRule,
): ReadonlyArray<RosterPlayer> {
  return EffectArray.flatMap(members, (player) => {
    const flatMapped2 =
      player.slot.status === "verified"
        ? [
            rosterPlayer(
              player,
              player.slot.slot,
              values.get(player.providerPlayerKey),
              slots,
              rule,
            ),
          ]
        : [];
    return arrayValueIsArray(flatMapped2) ? flatMapped2 : [flatMapped2];
  });
}

function rosterPlayer(
  player: ProviderRoster["players"][number],
  slot: string,
  value: ProviderPlayerScore | undefined,
  slots: ReadonlyArray<RosterSlot>,
  rule: RosterRule,
): RosterPlayer {
  if (value === undefined) {
    throw new Error("A provider lineup score must cover every roster player.");
  }
  const place = rosterPlaceOf(player);
  return {
    id: makePlayerId(player.providerPlayerKey),
    eligiblePositions: place.positions,
    availabilityTier: makeAvailabilityTier(value.availability),
    selection: selection(value.score),
    reserveEligible: EffectArray.some(
      rule.slots,
      (entry) =>
        entry.kind === "reserve" && slotPlacement(rule, entry.position, place).legal === true,
    ),
    reserveSlotIds: reserveSlotIds(rule, place, makeSlotId),
    lockedSlotId: player.isEditable === true ? undefined : makeSlotId(slot),
    currentSlotId: EffectArray.some(slots, (entry) => String(entry.id) === slot)
      ? makeSlotId(slot)
      : undefined,
    mayBeLeftInPlace: mayBeLeftInPlace(player, slots, rule),
  };
}

function mayBeLeftInPlace(
  player: ProviderRoster["players"][number],
  slots: ReadonlyArray<RosterSlot>,
  rule: RosterRule,
): boolean {
  const place = rosterPlaceOf(player);
  const current =
    player.slot.status === "verified" ? rule.byPosition.get(player.slot.slot) : undefined;
  return (
    !acceptsSlot(slots, rule, place) ||
    (current?.kind === "reserve" && slotPlacement(rule, current.position, place).legal !== true)
  );
}

function rosterPlaceOf(player: ProviderRoster["players"][number]): {
  readonly positions: ReadonlyArray<string>;
  readonly injured: boolean;
} {
  return {
    positions: player.eligiblePositions,
    injured: rosterPlayerInjured(player),
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
  rule: RosterRule,
): ReadonlyArray<RosterSlot> {
  const id = makeSlotId(position.position);
  const eligibility = slotEligibility(rule, position);
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

function slotEligibility(rule: RosterRule, slot: RuleSlot): SlotEligibility {
  if (slot.kind === "bench") {
    return { kind: "any" };
  }
  if (slot.kind === "reserve" && rule.reserveEligibility.kind === "injury_status") {
    return { kind: "any" };
  }
  return slot.eligibility.length === 0
    ? { kind: "any" }
    : { kind: "positions", positions: [...slot.eligibility] };
}

function requireSlotId(idByPosition: ReadonlyMap<string, SlotId>, position: string): SlotId {
  const id = idByPosition.get(position);
  if (id === undefined) {
    throw new Error(`A roster slot ${position} was not declared for placement.`);
  }
  return id;
}

function reserveSlotIds(
  rule: RosterRule,
  place: RosterPlaceFacts,
  idOf: (position: string) => SlotId,
): ReadonlyArray<SlotId> {
  return EffectArray.flatMap(rule.slots, (slot) => {
    const flatMapped3 =
      slot.kind === "reserve" && slotPlacement(rule, slot.position, place).legal === true
        ? [idOf(slot.position)]
        : [];
    return arrayValueIsArray(flatMapped3) ? flatMapped3 : [flatMapped3];
  });
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

export type RosterPlacementPlayer = {
  readonly key: string;
  readonly name: string;
  readonly positions: ReadonlyArray<string>;
  readonly slot: string | undefined;
  readonly injured: boolean;
  readonly editable: boolean;
};

export type RosterPlacementMove = {
  readonly playerKey: string;
  readonly playerName: string;
  readonly fromSlot: string;
  readonly toSlot: string;
};

export type RosterPlacementResult =
  | {
      readonly kind: "planned";
      readonly placements: ReadonlyMap<string, string>;
      readonly moves: ReadonlyArray<RosterPlacementMove>;
    }
  | { readonly kind: "refused"; readonly detail: string };
