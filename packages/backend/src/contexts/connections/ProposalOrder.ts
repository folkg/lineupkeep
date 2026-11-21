import {
  knownSelection,
  makeAvailabilityTier,
  makePlayerId,
  makeSelectionBasis,
  makeSlotId,
  solveLineup,
  unusableSelection,
} from "@lineupkeep/lineup-solver";
import type { RosterPlayer, RosterSlot } from "@lineupkeep/lineup-solver";
import { Array as EffectArray } from "effect";
import { Option as EffectOption } from "effect";

import type { ProviderRosterConstraints } from "./Provider.ts";
import { rosterRuleOf, slotCapacity, slotPlacement } from "./RosterSlots.ts";
import type { RosterRule } from "./RosterSlots.ts";

const neutralBasis = makeSelectionBasis("proposal-order");
const neutralTier = makeAvailabilityTier("proposal-order");

export function placeIntentItems(input: ProposalPlacementInput): ProposalPlacementResult {
  const league = leagueOf(input.slots, input.constraints);
  const state = new Map(initialState(input.players));
  for (const item of input.items) {
    for (const drop of item.drops) {
      state.delete(drop.key);
    }
  }
  for (const item of input.items) {
    if (item.move === undefined) {
      continue;
    }
    const moving = state.get(item.move.player.key);
    if (moving !== undefined) {
      state.set(moving.key, { ...moving, slot: item.move.toSlot });
    }
  }
  for (const item of input.items) {
    for (const add of item.adds) {
      if (state.has(add.key)) {
        continue;
      }
      state.set(add.key, {
        key: add.key,
        name: add.name,
        positions: add.positions ?? [],
        slot: undefined,
        editable: true,
        injured: false,
      });
    }
  }

  const refused: Array<ProposalPlacementRefusal> = [];
  const activeIntents: Array<{
    readonly item: string;
    readonly player: RosterMember;
    readonly added: boolean;
  }> = [];
  const reserveIntents: Array<{
    readonly item: string;
    readonly player: RosterMember;
    readonly added: boolean;
  }> = [];
  const leavingReserve = new Set<string>();

  for (const item of input.items) {
    const intent = item.intent;
    if (intent === undefined) {
      continue;
    }
    if (intent.kind === "add") {
      for (const add of item.adds) {
        const player = state.get(add.key);
        if (player === undefined) {
          continue;
        }
        if (intent.to === "reserve") {
          reserveIntents.push({ item: item.id, player, added: true });
        } else {
          activeIntents.push({ item: item.id, player, added: true });
        }
      }
      continue;
    }
    const player = state.get(intent.player.key);
    if (player === undefined) {
      continue;
    }
    const slot = player.slot === undefined ? undefined : league.byPosition.get(player.slot);
    if (intent.kind === "activate") {
      if (slot === undefined) {
        refused.push({
          item: item.id,
          code: "state_unavailable",
          detail: `Your league reports no place for ${player.name}, so there is nothing to activate.`,
        });
        continue;
      }
      if (slot.kind !== "reserve") {
        refused.push({
          item: item.id,
          code: "intent_invalid",
          detail: `${player.name} is already on the active roster, so there is nothing to activate.`,
        });
        continue;
      }
      leavingReserve.add(player.key);
      activeIntents.push({ item: item.id, player, added: false });
      continue;
    }
    if (slot === undefined) {
      refused.push({
        item: item.id,
        code: "state_unavailable",
        detail: `Your league reports no place for ${player.name}, so there is nothing to stash.`,
      });
      continue;
    }
    if (slot.kind === "reserve") {
      refused.push({
        item: item.id,
        code: "intent_invalid",
        detail: `${player.name} is already on a reserve list, so there is nothing to stash.`,
      });
      continue;
    }
    reserveIntents.push({ item: item.id, player, added: false });
  }

  const placements: Array<ProposalPlacement> = [];
  const moves: Array<ProposalPlacementMove> = [];
  const after: Array<ProposalPlacementAfter> = [];

  for (const intent of reserveIntents) {
    const destination = reserveDestination(state, league, intent.player, leavingReserve);
    if (destination.status !== "open") {
      refused.push({
        item: intent.item,
        code: destination.status === "unknown" ? "state_unavailable" : "reserve_unavailable",
        detail: reserveRefusalDetail(intent.player.name, destination, league.rule),
      });
      continue;
    }
    const slot = destination.slot;
    state.set(intent.player.key, { ...intent.player, slot: slot.position });
    const accepts =
      league.rule.reserveEligibility.kind === "injury_status"
        ? "accepts an injured player"
        : "accepts their positions";
    const detail = intent.added
      ? `${intent.player.name} goes to the ${slot.position} reserve list after the add, which ${accepts} and has a free place.`
      : `${intent.player.name} moves to the ${slot.position} reserve list, which ${accepts} and has a free place.`;
    placements.push({
      item: intent.item,
      playerKey: intent.player.key,
      playerName: intent.player.name,
      ...(intent.player.slot === undefined ? {} : { fromSlot: intent.player.slot }),
      toSlot: slot.position,
      detail,
    });
    if (intent.added) {
      after.push({
        item: intent.item,
        repair: {
          playerKey: intent.player.key,
          playerName: intent.player.name,
          toSlot: slot.position,
        },
      });
    } else {
      moves.push({
        item: intent.item,
        player: { key: intent.player.key, name: intent.player.name },
        toSlot: slot.position,
      });
    }
  }

  const active = activeDestinations(state, league, activeIntents, input.constraints);
  for (const intent of activeIntents) {
    const destination = active.destinations.get(intent.player.key);
    const detail = active.refused.get(intent.player.key);
    if (destination === undefined) {
      refused.push({
        item: intent.item,
        code: "slot_illegal",
        detail:
          detail ??
          `${intent.player.name} has no place on the active roster: every place that would accept them is taken.`,
      });
      continue;
    }
    const slot = league.byPosition.get(destination);
    placements.push({
      item: intent.item,
      playerKey: intent.player.key,
      playerName: intent.player.name,
      ...(intent.player.slot === undefined ? {} : { fromSlot: intent.player.slot }),
      toSlot: destination,
      detail: intent.added
        ? activePlaceDetail(intent.player.name, destination, slot?.kind)
        : activePlaceDetailFrom(intent.player.name, intent.player.slot, destination, slot?.kind),
    });
    if (!intent.added) {
      moves.push({
        item: intent.item,
        player: { key: intent.player.key, name: intent.player.name },
        toSlot: destination,
      });
    }
  }

  return { placements, moves, after, refused };
}

function activeDestinations(
  state: RosterState,
  league: League,
  intents: ReadonlyArray<{
    readonly item: string;
    readonly player: RosterMember;
    readonly added: boolean;
  }>,
  constraints: ProviderRosterConstraints,
): {
  readonly destinations: ReadonlyMap<string, string>;
  readonly refused: ReadonlyMap<string, string>;
} {
  if (intents.length === 0) {
    return { destinations: new Map(), refused: new Map() };
  }
  const intentKeys = new Set(EffectArray.map(intents, (intent) => intent.player.key));
  const preferBench =
    constraints.startingSlotsMayStandEmpty &&
    EffectArray.some(league.slots, (slot) => slot.kind === "bench");
  const players = EffectArray.map([...state.values()], (player) =>
    intentKeys.has(player.key)
      ? activeSolverPlayer(player, preferBench)
      : solverPlayer(player, league, true),
  );
  const solved = solveLineup({
    selectionBasis: neutralBasis,
    availabilityTiers: [neutralTier],
    slots: EffectArray.map(league.slots, (slot) => slot.solver),
    players,
  });
  if (solved.kind === "plan") {
    const byPlayer = new Map(
      EffectArray.map(
        solved.plan.assignments,
        (assignment) => [String(assignment.playerId), String(assignment.slotId)] as const,
      ),
    );
    return {
      destinations: new Map(
        EffectArray.flatMap(intents, (intent) => {
          const slot = byPlayer.get(intent.player.key);
          return slot === undefined ? [] : [[intent.player.key, slot] as const];
        }),
      ),
      refused: new Map(),
    };
  }
  const stranded =
    solved.refusal.reason === "player-has-no-legal-slot"
      ? new Set(EffectArray.map(solved.refusal.playerIds, String))
      : new Set<string>();
  const destinations = new Map<string, string>();
  const refused = new Map<string, string>();
  for (const intent of intents) {
    if (stranded.has(intent.player.key)) {
      refused.set(
        intent.player.key,
        `${intent.player.name} has no place on the active roster: every place that would accept them is taken.`,
      );
      continue;
    }
    const slot = fallbackActiveSlot(state, league, intent.player);
    if (slot === undefined) {
      refused.set(
        intent.player.key,
        `${intent.player.name} has no place on the active roster: every place that would accept them is taken.`,
      );
      continue;
    }
    destinations.set(intent.player.key, slot);
  }
  return { destinations, refused };
}

function activeSolverPlayer(player: RosterMember, preferBench: boolean): RosterPlayer {
  return {
    id: makePlayerId(player.key),
    eligiblePositions: player.positions,
    availabilityTier: neutralTier,
    selection: preferBench
      ? unusableSelection(neutralBasis, "missing")
      : knownSelection(neutralBasis, 0),
    reserveEligible: false,
    lockedSlotId: undefined,
    currentSlotId: undefined,
    mayBeLeftInPlace: false,
  };
}

function fallbackActiveSlot(
  state: RosterState,
  league: League,
  player: RosterMember,
): string | undefined {
  const bench = EffectOption.getOrUndefined(
    EffectArray.findFirst(
      league.slots,
      (slot) => slot.kind === "bench" && openSlot(state, league, slot, player),
    ),
  );
  if (bench !== undefined) {
    return bench.position;
  }
  return EffectOption.getOrUndefined(
    EffectArray.findFirst(
      league.slots,
      (slot) => slot.kind === "starting" && openSlot(state, league, slot, player),
    ),
  )?.position;
}

type ReserveDestination =
  | { readonly status: "open"; readonly slot: LeagueSlot }
  | { readonly status: "none" }
  | { readonly status: "full"; readonly lists: ReadonlyArray<string> }
  | { readonly status: "unknown" };

function reserveDestination(
  state: RosterState,
  league: League,
  player: RosterMember,
  leaving: ReadonlySet<string>,
): ReserveDestination {
  const placements = EffectArray.map(
    EffectArray.filter(league.slots, (slot) => slot.kind === "reserve"),
    (slot) => ({ slot, legal: slotPlacement(league.rule, slot.position, player) }),
  );
  const eligible = EffectArray.filter(placements, (entry) => entry.legal.legal === true);
  if (eligible.length === 0) {
    return EffectArray.some(placements, (entry) => entry.legal.legal === "unknown")
      ? { status: "unknown" }
      : { status: "none" };
  }
  const open = EffectOption.getOrUndefined(
    EffectArray.findFirst(eligible, (entry) => {
      const occupants = EffectArray.filter(
        [...state.values()],
        (occupant) => occupant.slot === entry.slot.position && !leaving.has(occupant.key),
      );
      return occupants.length < entry.slot.count;
    }),
  );
  if (open !== undefined) {
    return { status: "open", slot: open.slot };
  }
  return { status: "full", lists: EffectArray.map(eligible, (entry) => entry.slot.position) };
}

function reserveRefusalDetail(
  name: string,
  destination: ReserveDestination,
  rule: RosterRule,
): string {
  switch (destination.status) {
    case "none":
      return rule.reserveEligibility.kind === "injury_status"
        ? `${name} cannot sit on a reserve list: the league's reserve lists only accept an injured player, and ${name} is not injured.`
        : `${name} cannot sit on a reserve list: the league lists none they are eligible for.`;
    case "full":
      return `${name} cannot sit on a reserve list: the league's ${nameList(destination.lists)} ${destination.lists.length === 1 ? "reserve list has" : "reserve lists have"} no free place.`;
    case "unknown":
      return `${name} cannot sit on a reserve list: the league does not publish which players each of its reserve lists accepts.`;
    case "open":
      return "";
  }
}

function activePlaceDetailFrom(
  name: string,
  from: string | undefined,
  slot: string,
  kind: "starting" | "bench" | "reserve" | undefined,
): string {
  const origin = from === undefined ? "their reserve place" : `the ${from} reserve list`;
  switch (kind) {
    case "bench":
      return `${name} moves from ${origin} to ${slot} on the bench, which has room and asks them to start nothing.`;
    case "starting":
      return `${name} moves from ${origin} to the ${slot} starting place, the only active place open to them.`;
    case "reserve":
      return `${name} moves from ${origin} to the ${slot} reserve list, which accepts their positions and has a free place.`;
    case undefined:
      return `${name} moves from ${origin} to ${slot}, which has room for them.`;
  }
}

function activePlaceDetail(
  name: string,
  slot: string,
  kind: "starting" | "bench" | "reserve" | undefined,
): string {
  switch (kind) {
    case "bench":
      return `${name} goes to ${slot} on the bench, which has room and asks them to start nothing.`;
    case "starting":
      return `${name} goes to the ${slot} starting place, the only active place open to them.`;
    case "reserve":
      return `${name} goes to the ${slot} reserve list, which accepts their positions and has a free place.`;
    case undefined:
      return `${name} goes to ${slot}, which has room for them.`;
  }
}

function openSlot(
  state: RosterState,
  league: League,
  slot: ProposalOrderSlot,
  player: RosterMember,
): boolean {
  const capacity = slotCapacity(league.rule, slot);
  if (capacity !== undefined && occupancyOf(state, slot.position) >= capacity) {
    return false;
  }
  return slotPlacement(league.rule, slot.position, player).legal === true;
}

function nameList(names: ReadonlyArray<string>): string {
  const first = names[0];
  if (first === undefined) {
    return "no one";
  }
  if (names.length === 1) {
    return first;
  }
  return `${EffectArray.join(names.slice(0, -1), ", ")} and ${String(names[names.length - 1])}`;
}

function solverPlayer(player: RosterMember, league: League, pin: boolean): RosterPlayer {
  const slot = player.slot === undefined ? undefined : league.byPosition.get(player.slot);
  return {
    id: makePlayerId(player.key),
    eligiblePositions: player.positions,
    availabilityTier: neutralTier,
    selection: knownSelection(neutralBasis, 0),
    reserveEligible: reserveEligible(player, league),
    lockedSlotId: pin && slot !== undefined ? makeSlotId(slot.position) : undefined,
    currentSlotId: slot === undefined ? undefined : makeSlotId(slot.position),
    mayBeLeftInPlace: false,
  };
}

function reserveEligible(player: RosterMember, league: League): boolean {
  return EffectArray.some(
    league.slots,
    (slot) =>
      slot.kind === "reserve" && slotPlacement(league.rule, slot.position, player).legal === true,
  );
}

function solverSlot(slot: ProposalOrderSlot, rule: RosterRule): RosterSlot {
  const id = makeSlotId(slot.position);
  const eligibility =
    slot.eligibility.length === 0
      ? ({ kind: "any" } as const)
      : ({ kind: "positions", positions: [...slot.eligibility] } as const);
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
        capacity:
          rule.benchCapacity === "generic" ? Math.max(rule.rosterMaximum, slot.count) : slot.count,
        eligibility: { kind: "any" },
      };
    case "reserve":
      return { kind: "reserve", id, capacity: slot.count, eligibility };
  }
}

function initialState(players: ReadonlyArray<ProposalOrderPlayer>): RosterState {
  return new Map(
    EffectArray.map(players, (player) => [
      player.key,
      {
        key: player.key,
        name: player.name,
        positions: player.positions,
        slot: player.slot,
        editable: player.editable,
        injured: player.injured ?? false,
      },
    ]),
  );
}

function occupancyOf(state: RosterState, slot: string): number {
  let count = 0;
  for (const player of state.values()) {
    if (player.slot === slot) {
      count += 1;
    }
  }
  return count;
}

function leagueOf(
  slots: ReadonlyArray<ProposalOrderSlot>,
  constraints: ProviderRosterConstraints,
): League {
  const rule = rosterRuleOf(constraints, slots);
  const leagueSlots = EffectArray.map(slots, (slot) => ({
    ...slot,
    solver: solverSlot(slot, rule),
  }));
  return {
    rule,
    slots: leagueSlots,
    byPosition: new Map(EffectArray.map(leagueSlots, (slot) => [slot.position, slot] as const)),
  };
}

type RosterMember = Omit<ProposalOrderPlayer, "injured"> & { readonly injured: boolean };

type RosterState = ReadonlyMap<string, RosterMember>;

type LeagueSlot = ProposalOrderSlot & { readonly solver: RosterSlot };

type League = {
  readonly rule: RosterRule;
  readonly slots: ReadonlyArray<LeagueSlot>;
  readonly byPosition: ReadonlyMap<string, LeagueSlot>;
};

type ProposalOrderSlot = {
  readonly position: string;
  readonly kind: "starting" | "bench" | "reserve";
  readonly count: number;
  readonly eligibility: ReadonlyArray<string>;
};

type ProposalOrderPlayer = {
  readonly key: string;
  readonly name: string;
  readonly positions: ReadonlyArray<string>;
  readonly slot: string | undefined;
  readonly editable: boolean;
  readonly injured?: boolean;
};

type ProposalOrderPlayerRef = {
  readonly key: string;
  readonly name: string;
  readonly positions?: ReadonlyArray<string>;
};

type ProposalOrderRepair = {
  readonly playerKey: string;
  readonly playerName: string;
  readonly fromSlot?: string;
  readonly toSlot: string;
};

type ProposalPlacementIntent =
  | { readonly kind: "activate"; readonly player: ProposalOrderPlayerRef }
  | { readonly kind: "stash"; readonly player: ProposalOrderPlayerRef }
  | { readonly kind: "add"; readonly to: "active" | "reserve" };

type ProposalOrderMove = {
  readonly player: ProposalOrderPlayerRef;
  readonly toSlot: string;
};

type ProposalPlacementItem = {
  readonly id: string;
  readonly adds: ReadonlyArray<ProposalOrderPlayerRef>;
  readonly drops: ReadonlyArray<ProposalOrderPlayerRef>;
  readonly move: ProposalOrderMove | undefined;
  readonly intent: ProposalPlacementIntent | undefined;
};

export type ProposalPlacementInput = {
  readonly constraints: ProviderRosterConstraints;
  readonly slots: ReadonlyArray<ProposalOrderSlot>;
  readonly players: ReadonlyArray<ProposalOrderPlayer>;
  readonly items: ReadonlyArray<ProposalPlacementItem>;
};

type ProposalPlacement = {
  readonly item: string;
  readonly playerKey: string;
  readonly playerName: string;
  readonly fromSlot?: string;
  readonly toSlot: string;
  readonly detail: string;
};

type ProposalPlacementMove = {
  readonly item: string;
  readonly player: ProposalOrderPlayerRef;
  readonly toSlot: string;
};

type ProposalPlacementAfter = {
  readonly item: string;
  readonly repair: ProposalOrderRepair;
};

type ProposalPlacementRefusalCode =
  | "reserve_unavailable"
  | "intent_invalid"
  | "slot_illegal"
  | "state_unavailable";

type ProposalPlacementRefusal = {
  readonly item: string;
  readonly code: ProposalPlacementRefusalCode;
  readonly detail: string;
};

export type ProposalPlacementResult = {
  readonly placements: ReadonlyArray<ProposalPlacement>;
  readonly moves: ReadonlyArray<ProposalPlacementMove>;
  readonly after: ReadonlyArray<ProposalPlacementAfter>;
  readonly refused: ReadonlyArray<ProposalPlacementRefusal>;
};
