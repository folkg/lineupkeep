import {
  knownSelection,
  makeAvailabilityTier,
  makePlayerId,
  makeSelectionBasis,
  makeSlotId,
  solveLineup,
} from "@lineupkeep/lineup-solver";
import type {
  LineupProblem,
  LineupRefusal,
  RosterPlayer,
  RosterSlot,
} from "@lineupkeep/lineup-solver";
import { DateTime } from "effect";

import type { ProviderRosterConstraints } from "./Provider.ts";
import {
  rosterOccupancy,
  rosterPlaceChange,
  rosterPlaceCount,
  rosterRuleOf,
  slotCapacity,
  slotPlacement,
} from "./RosterSlots.ts";
import type { RosterRule } from "./RosterSlots.ts";

const conflictLimit = 3;
const neutralBasis = makeSelectionBasis("proposal-order");
const neutralTier = makeAvailabilityTier("proposal-order");

export function planProposalOrder(input: ProposalOrderInput): ProposalOrderPlan {
  const timing = timingOf(input.timing);
  const league = leagueOf(input.slots, input.constraints);
  const locked = input.items.flatMap((item) => lockedReasons(item, input.players, timing));
  if (locked.length > 0) {
    return conflictPlan(timing, [refusalConflict(locked)]);
  }
  const ordered = orderSteps(input, league, timing);
  if (ordered.status === "conflict") {
    return conflictPlan(timing, ordered.conflicts);
  }
  return {
    status: "ordered",
    timing: timing.rule,
    ...(timing.effectiveDate === undefined ? {} : { effectiveDate: timing.effectiveDate }),
    rosterPlaces: ordered.rosterPlaces,
    steps: ordered.steps.map((step, position) => ({
      item: step.item.id,
      position,
      ...(step.rosterPlace === undefined ? {} : { rosterPlace: step.rosterPlace }),
      ...(step.reserveMove === undefined ? {} : { reserveMove: step.reserveMove }),
    })),
  };
}

export function rosterChangeDate(timing: ProposalOrderTiming): string | undefined {
  return timingOf(timing).effectiveDate ?? timing.currentDate;
}

function conflictPlan(
  timing: Timing,
  conflicts: ReadonlyArray<ProposalOrderPlanConflict>,
): ProposalOrderPlan {
  return {
    status: "conflict",
    timing: timing.rule,
    ...(timing.effectiveDate === undefined ? {} : { effectiveDate: timing.effectiveDate }),
    conflicts,
  };
}

type Scheduling =
  | {
      readonly status: "ordered";
      readonly steps: ReadonlyArray<OrderedStep>;
      readonly rosterPlaces: ProposalOrderRosterPlaces;
    }
  | { readonly status: "conflict"; readonly conflicts: ReadonlyArray<ProposalOrderPlanConflict> };

type OrderedStep = {
  readonly item: ProposalOrderItem;
  readonly rosterPlace?: ProposalOrderRosterPlace;
  reserveMove?: OrderedRepair;
};

type OrderedRepair = ProposalOrderRepair & { readonly order: "before" | "after" };

type DeclaredItem = {
  readonly item: ProposalOrderItem;
  readonly index: number;
};

function orderSteps(input: ProposalOrderInput, league: League, timing: Timing): Scheduling {
  const entries: ReadonlyArray<DeclaredItem> = input.items.map((item, index) => ({
    item,
    index,
  }));
  const dropsOfPlayer = new Set(input.items.flatMap((item) => item.drops.map((drop) => drop.key)));
  const declaredMoveKeys = declaredMovers(input.items);
  const blocked = new Set([
    ...declaredMoveKeys,
    ...input.items.flatMap((item) => [
      ...item.adds.map((add) => add.key),
      ...item.drops.map((drop) => drop.key),
    ]),
  ]);
  const pending = [...entries];
  const steps: Array<OrderedStep> = [];
  const held = new Set<string>();
  const initial = initialState(input.players);
  const context: RefusalContext = { items: input.items, initial };
  let state = initial;
  let hold: ProposalOrderRepair | undefined;

  while (pending.length > 0) {
    const items = pending.map((entry) => entry.item);
    const candidates = [...pending].sort(
      (left, right) =>
        rankOf(state, left.item, dropsOfPlayer, league) -
          rankOf(state, right.item, dropsOfPlayer, league) || left.index - right.index,
    );
    let chosen: { readonly entry: DeclaredItem; readonly state: RosterState } | undefined;
    const refused: Array<BlockedItem> = [];
    const waiting: Array<BlockedItem> = [];
    for (const entry of candidates) {
      const applied = applyDeclared(state, entry.item, league);
      if (applied.status === "refused") {
        if (
          applied.code === "move_slot_full" &&
          freesDestination(state, entry.item, pending, league)
        ) {
          waiting.push({ entry, refusal: applied });
        } else {
          refused.push({ entry, refusal: applied });
        }
        continue;
      }
      const readiness = awaitItem(
        state,
        applied.state,
        entry.item,
        pending,
        league,
        declaredMoveKeys,
        context,
      );
      if (readiness.status === "wait") {
        waiting.push({ entry, refusal: readiness.refusal });
        continue;
      }
      if (readiness.status === "refused") {
        refused.push({ entry, refusal: readiness.refusal });
        continue;
      }
      chosen = { entry, state: applied.state };
      break;
    }
    if (chosen !== undefined) {
      const before = state;
      state = chosen.state;
      let reserveMove: OrderedRepair | undefined =
        hold === undefined ? undefined : { ...hold, order: "before" };
      hold = undefined;
      if (chosen.entry.item.mayRepair && reserveMove === undefined && !isLegal(state, league)) {
        const repaired = planRepair(state, league, blocked, declaredMoveKeys);
        if (repaired !== undefined) {
          state = repaired.state;
          reserveMove = {
            ...repaired.repair,
            order: repairSendsBefore(before, repaired.repair, league) ? "before" : "after",
          };
        }
      }
      const rosterPlace = rosterPlaceOf(chosen.entry.item, initial, league);
      steps.push({
        item: chosen.entry.item,
        ...(rosterPlace === undefined ? {} : { rosterPlace }),
        ...(reserveMove === undefined ? {} : { reserveMove }),
      });
      pending.splice(pending.indexOf(chosen.entry), 1);
      continue;
    }

    const cycle = findCycle(state, items, league);
    if (cycle !== undefined) {
      const planned = planHold(state, cycle, held, league);
      if (planned === undefined) {
        return { status: "conflict", conflicts: cycleConflicts(state, cycle, league, timing) };
      }
      state = relocate(state, planned.playerKey, planned.toSlot);
      held.add(planned.playerKey);
      hold = planned;
      continue;
    }

    if (refused.length > 0) {
      return {
        status: "conflict",
        conflicts: [itemRefusalConflict(refused)],
      };
    }
    return { status: "conflict", conflicts: waitingConflicts(waiting, timing) };
  }

  const failure = placementFailure(state, league, context);
  if (failure !== undefined) {
    return {
      status: "conflict",
      conflicts: [
        conflictWithReasons(
          input.items,
          input.items.map((item) => ({
            item: item.id,
            code: failure.code,
            detail: `${item.label}: ${failure.detail}`,
          })),
          failure.detail,
          timing,
        ),
      ],
    };
  }
  const refusal = placementRefusal(state, league);
  if (refusal !== undefined) {
    const detail = strandedDetail(state, league, refusal, context);
    const reasons = strandedReasons(input.items, refusal, detail);
    return {
      status: "conflict",
      conflicts: [
        reasons.length > 0
          ? refusalConflict(reasons)
          : conflictWithReasons(input.items, [], detail, timing),
      ],
    };
  }
  return {
    status: "ordered",
    steps,
    rosterPlaces: {
      maximum: league.rule.rosterMaximum,
      occupied: rosterOccupancy({ rule: league.rule, players: [...initial.values()] }).occupied,
      net: netPlaceChange(input.items, initial, league),
    },
  };
}

type Readiness =
  | { readonly status: "ready" }
  | { readonly status: "wait"; readonly refusal: Refusal }
  | { readonly status: "refused"; readonly refusal: Refusal };

function awaitItem(
  state: RosterState,
  applied: RosterState,
  item: ProposalOrderItem,
  pending: ReadonlyArray<DeclaredItem>,
  league: League,
  declaredMoveKeys: ReadonlySet<string>,
  context: RefusalContext,
): Readiness {
  const others = pending.flatMap((entry) => (entry.item === item ? [] : [entry.item]));
  const before = item.adds.length > 0 ? placementFailure(state, league, context) : undefined;
  if (
    item.adds.length > 0 &&
    before !== undefined &&
    !repairsBefore(state, applied, item, league, declaredMoveKeys)
  ) {
    return others.some((other) => curesPlacement(state, other, league))
      ? { status: "wait", refusal: before }
      : { status: "refused", refusal: before };
  }
  const after = placementFailure(applied, league, context);
  if (after?.code !== "roster_full") {
    return { status: "ready" };
  }
  if (repairsPlace(applied, item, league, declaredMoveKeys)) {
    return { status: "ready" };
  }
  if (others.some((other) => freesPlace(state, other, league))) {
    return { status: "wait", refusal: after };
  }
  return { status: "refused", refusal: after };
}

function repairsBefore(
  state: RosterState,
  applied: RosterState,
  item: ProposalOrderItem,
  league: League,
  declaredMoveKeys: ReadonlySet<string>,
): boolean {
  if (!item.mayRepair) {
    return false;
  }
  const repaired = planRepair(
    applied,
    league,
    blockedKeys(item, declaredMoveKeys),
    declaredMoveKeys,
  );
  return (
    repaired !== undefined &&
    isLegal(relocate(state, repaired.repair.playerKey, repaired.repair.toSlot), league)
  );
}

function repairsPlace(
  state: RosterState,
  item: ProposalOrderItem,
  league: League,
  declaredMoveKeys: ReadonlySet<string>,
): boolean {
  return (
    item.mayRepair &&
    planRepair(state, league, blockedKeys(item, declaredMoveKeys), declaredMoveKeys) !== undefined
  );
}

function blockedKeys(
  item: ProposalOrderItem,
  declaredMoveKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set([
    ...declaredMoveKeys,
    ...item.adds.map((add) => add.key),
    ...item.drops.map((drop) => drop.key),
  ]);
}

function curesPlacement(state: RosterState, item: ProposalOrderItem, league: League): boolean {
  if (item.drops.some((drop) => illegalOccupant(state, drop.key, league))) {
    return true;
  }
  return item.move !== undefined && illegalOccupant(state, item.move.player.key, league);
}

function freesDestination(
  state: RosterState,
  item: ProposalOrderItem,
  pending: ReadonlyArray<DeclaredItem>,
  league: League,
): boolean {
  if (item.move === undefined) {
    return false;
  }
  const destination = league.byPosition.get(item.move.toSlot);
  const capacity = destination === undefined ? undefined : slotCapacity(league.rule, destination);
  if (destination === undefined || capacity === undefined) {
    return false;
  }
  const occupants = [...state.values()].filter((player) => player.slot === destination.position);
  return pending.some(
    (entry) =>
      entry.item !== item &&
      (entry.item.drops.some((drop) => occupants.some((player) => player.key === drop.key)) ||
        (entry.item.move !== undefined &&
          occupants.some((player) => player.key === entry.item.move?.player.key))),
  );
}

function freesPlace(state: RosterState, item: ProposalOrderItem, league: League): boolean {
  if (
    item.drops.some((drop) => {
      const dropped = state.get(drop.key);
      return dropped !== undefined && rosterPlaceCount(league.rule, dropped.slot) > 0;
    })
  ) {
    return true;
  }
  const mover = item.move === undefined ? undefined : state.get(item.move.player.key);
  return (
    item.move !== undefined &&
    mover?.slot !== undefined &&
    rosterPlaceChange(league.rule, mover.slot, item.move.toSlot).frees > 0
  );
}

function inReserve(player: RosterMember | undefined, league: League): boolean {
  return player?.slot !== undefined && rosterPlaceCount(league.rule, player.slot) === 0;
}

function rankOf(
  state: RosterState,
  item: ProposalOrderItem,
  dropsOfPlayer: ReadonlySet<string>,
  league: League,
): number {
  if (item.move === undefined) {
    return 1;
  }
  const key = item.move.player.key;
  return dropsOfPlayer.has(key) || illegalOccupant(state, key, league) ? 0 : 1;
}

function findCycle(
  state: RosterState,
  pending: ReadonlyArray<ProposalOrderItem>,
  league: League,
): ReadonlyArray<ProposalOrderItem> | undefined {
  const edges = new Map<ProposalOrderItem, ReadonlyArray<ProposalOrderItem>>();
  for (const item of pending) {
    const destination = item.move?.toSlot;
    const slot = destination === undefined ? undefined : league.byPosition.get(destination);
    const capacity = slot === undefined ? undefined : slotCapacity(league.rule, slot);
    if (destination === undefined || capacity === undefined) {
      continue;
    }
    if (occupancyOf(state, destination) < capacity) {
      continue;
    }
    const occupants = [...state.values()].filter((player) => player.slot === destination);
    edges.set(
      item,
      pending.filter(
        (other) =>
          other !== item &&
          occupants.some(
            (occupant) =>
              other.drops.some((drop) => drop.key === occupant.key) ||
              other.move?.player.key === occupant.key,
          ),
      ),
    );
  }

  for (const start of pending) {
    if (!edges.has(start)) {
      continue;
    }
    const cycle = visit(start, edges, [], new Set());
    if (cycle !== undefined) {
      return cycle;
    }
  }
  return undefined;
}

function visit(
  item: ProposalOrderItem,
  edges: ReadonlyMap<ProposalOrderItem, ReadonlyArray<ProposalOrderItem>>,
  path: Array<ProposalOrderItem>,
  explored: Set<ProposalOrderItem>,
): ReadonlyArray<ProposalOrderItem> | undefined {
  const at = path.indexOf(item);
  if (at >= 0) {
    return path.slice(at);
  }
  if (explored.has(item)) {
    return undefined;
  }
  path.push(item);
  for (const next of edges.get(item) ?? []) {
    const cycle = visit(next, edges, path, explored);
    if (cycle !== undefined) {
      return cycle;
    }
  }
  path.pop();
  explored.add(item);
  return undefined;
}

function planHold(
  state: RosterState,
  cycle: ReadonlyArray<ProposalOrderItem>,
  held: ReadonlySet<string>,
  league: League,
): ProposalOrderRepair | undefined {
  for (const item of cycle) {
    const move = item.move;
    const player = move === undefined ? undefined : state.get(move.player.key);
    if (move === undefined || player?.slot === undefined || held.has(player.key)) {
      continue;
    }
    const destination = league.slots.find(
      (slot) =>
        slot.kind === "bench" &&
        slot.position !== player.slot &&
        slot.position !== move.toSlot &&
        openSlot(state, league, slot, player),
    );
    if (destination !== undefined) {
      return repairOf(player, player.slot, destination.position);
    }
  }
  return undefined;
}

type Application =
  | { readonly status: "applied"; readonly state: RosterState }
  | {
      readonly status: "refused";
      readonly code: ProposalOrderRefusalCode;
      readonly detail: string;
    };

function applyDeclared(state: RosterState, item: ProposalOrderItem, league: League): Application {
  const refused = (code: ProposalOrderRefusalCode, detail: string): Application => ({
    status: "refused",
    code,
    detail,
  });
  const next = new Map(state);
  if (item.move !== undefined) {
    const moving = next.get(item.move.player.key);
    if (moving === undefined) {
      return refused(
        "move_not_rostered",
        `${item.move.player.name} is no longer on the roster, so the move cannot be made.`,
      );
    }
    if (moving.slot === undefined) {
      return refused(
        "slot_illegal",
        `Your league reports no verified slot for ${moving.name}, so the move cannot be planned.`,
      );
    }
    const slot = league.byPosition.get(item.move.toSlot);
    if (slot === undefined) {
      return refused(
        "move_slot_unknown",
        `The league does not declare a ${item.move.toSlot} slot, so ${moving.name} cannot move there.`,
      );
    }
    const placement = slotPlacement(league.rule, slot.position, moving.positions);
    if (placement.legal === "unknown") {
      return refused(
        "state_unavailable",
        `The league does not publish how reserve eligibility is established, so ${moving.name} cannot be moved to the ${slot.position} reserve list.`,
      );
    }
    if (!placement.legal) {
      return refused(
        "slot_illegal",
        `${moving.name} cannot move to the ${slotLabel(slot)}: it does not accept their positions (${moving.positions.join(", ")}).`,
      );
    }
    const capacity = slotCapacity(league.rule, slot);
    if (capacity !== undefined && occupancyOf(next, slot.position) >= capacity) {
      return refused("move_slot_full", slotFullDetail(moving, slot, next));
    }
    next.set(moving.key, { ...moving, slot: slot.position });
  }
  for (const drop of item.drops) {
    if (!next.has(drop.key)) {
      return refused(
        "drop_not_rostered",
        `${drop.name} is no longer on the roster, so the drop cannot be made.`,
      );
    }
    next.delete(drop.key);
  }
  for (const add of item.adds) {
    if (next.has(add.key)) {
      return refused(
        "add_already_rostered",
        `${add.name} is already on the roster, so the add cannot be made.`,
      );
    }
    next.set(add.key, {
      key: add.key,
      name: add.name,
      positions: add.positions ?? [],
      slot: undefined,
      editable: true,
      injured: false,
    });
  }
  return { status: "applied", state: next };
}

function planRepair(
  state: RosterState,
  league: League,
  blocked: ReadonlySet<string>,
  declaredMoveKeys: ReadonlySet<string>,
): { readonly state: RosterState; readonly repair: ProposalOrderRepair } | undefined {
  for (const player of state.values()) {
    if (player.slot === undefined || !player.editable || declaredMoveKeys.has(player.key)) {
      continue;
    }
    const slot = league.byPosition.get(player.slot);
    if (
      slot === undefined ||
      slotPlacement(league.rule, slot.position, player.positions).legal !== false
    ) {
      continue;
    }
    for (const destination of openSlots(state, league, player)) {
      const repaired = relocate(state, player.key, destination.position);
      if (isLegal(repaired, league)) {
        return { state: repaired, repair: repairOf(player, player.slot, destination.position) };
      }
    }
  }
  const candidates = [...state.values()]
    .filter(
      (player) =>
        player.slot !== undefined &&
        player.editable &&
        !blocked.has(player.key) &&
        !inReserve(player, league),
    )
    .sort(
      (left, right) =>
        Number(right.injured === true) - Number(left.injured === true) ||
        left.name.localeCompare(right.name) ||
        left.key.localeCompare(right.key),
    );
  for (const player of candidates) {
    if (player.slot === undefined) {
      continue;
    }
    for (const destination of openSlots(state, league, player)) {
      if (destination.kind !== "reserve") {
        continue;
      }
      const repaired = relocate(state, player.key, destination.position);
      if (isLegal(repaired, league)) {
        return { state: repaired, repair: repairOf(player, player.slot, destination.position) };
      }
    }
  }
  return undefined;
}

function openSlots(
  state: RosterState,
  league: League,
  player: RosterMember,
): ReadonlyArray<LeagueSlot> {
  const kindOrder = { bench: 0, starting: 1, reserve: 2 } as const;
  return league.slots
    .filter((slot) => slot.position !== player.slot && openSlot(state, league, slot, player))
    .sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind]);
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
  return slotPlacement(league.rule, slot.position, player.positions).legal === true;
}

function slotLabel(slot: ProposalOrderSlot): string {
  switch (slot.kind) {
    case "starting":
      return `${slot.position} starting slot`;
    case "bench":
      return `${slot.position} bench slot`;
    case "reserve":
      return `${slot.position} reserve list`;
  }
}

function slotFullDetail(moving: RosterMember, slot: ProposalOrderSlot, state: RosterState): string {
  const occupants = [...state.values()]
    .filter((player) => player.slot === slot.position)
    .map((player) => player.name);
  const names = nameList(occupants);
  const label = slotLabel(slot);
  return occupants.length === 1
    ? `Moving ${moving.name} to the ${label} is refused because ${names} already holds it. Move or drop ${names} first.`
    : `Moving ${moving.name} to the ${label} is refused because it already holds ${names} and allows ${String(slot.count)}. Move one of them first.`;
}

function nameList(names: ReadonlyArray<string>): string {
  const first = names[0];
  if (first === undefined) {
    return "no one";
  }
  if (names.length === 1) {
    return first;
  }
  return `${names.slice(0, -1).join(", ")} and ${String(names[names.length - 1])}`;
}

function relocate(state: RosterState, playerKey: string, slot: string): RosterState {
  const next = new Map(state);
  const player = next.get(playerKey);
  if (player !== undefined) {
    next.set(playerKey, { ...player, slot });
  }
  return next;
}

function repairOf(player: RosterMember, fromSlot: string, toSlot: string): ProposalOrderRepair {
  return {
    playerKey: player.key,
    playerName: player.name,
    fromSlot,
    toSlot,
  };
}

function repairSendsBefore(
  state: RosterState,
  repair: ProposalOrderRepair,
  league: League,
): boolean {
  const slot = league.byPosition.get(repair.toSlot);
  const player = state.get(repair.playerKey);
  return slot !== undefined && player !== undefined && openSlot(state, league, slot, player);
}

function placementFailure(
  state: RosterState,
  league: League,
  context?: RefusalContext,
): CompositionRefusal | undefined {
  const occupancy = rosterOccupancy({ rule: league.rule, players: [...state.values()] });
  if (occupancy.occupied > occupancy.maximum) {
    const message = `The team would hold ${String(occupancy.occupied)} players on its roster, but the league allows ${String(occupancy.maximum)}.`;
    if (context === undefined) {
      return {
        code: "roster_full",
        detail: `${message} Free a place by dropping a player on the roster or moving a reserve-eligible player to a reserve list.`,
      };
    }
    const accounting = setPlaceAccounting(context.items, context.initial, league);
    return {
      code: "roster_full",
      detail: `${message} This set frees ${placeCount(accounting.frees)} and consumes ${placeCount(accounting.consumes)}; free ${placeCount(occupancy.occupied - occupancy.maximum)} more by dropping a player or moving a reserve-eligible player to a reserve list.`,
    };
  }
  const illegal = occupancy.illegal[0];
  if (illegal !== undefined) {
    const already =
      context !== undefined &&
      context.items.some(
        (item) =>
          item.drops.some((drop) => drop.key === illegal.key) ||
          item.move?.player.key === illegal.key,
      );
    const resolution =
      occupancy.occupied >= occupancy.maximum
        ? `The team already holds all ${String(occupancy.maximum)} roster places, so free one by dropping a player or moving a reserve-eligible player to a reserve list.`
        : already
          ? "This set already names their drop or a slot move for them."
          : "Add a slot move that gives them a legal slot, or a drop for them, to this set.";
    return {
      code: "slot_illegal",
      detail: `${illegal.detail} ${resolution} Choosing which player to drop is yours.`,
    };
  }
  const overflow = occupancy.overflow[0];
  if (overflow !== undefined) {
    return {
      code: "slot_illegal",
      detail: `The ${slotLabel(overflow.slot)} holds ${String(overflow.occupants)} players, but the league allows ${String(overflow.slot.count)}. Move one out of it.`,
    };
  }
  return undefined;
}

function placeCount(count: number): string {
  return `${String(count)} ${count === 1 ? "place" : "places"}`;
}

function setPlaceAccounting(
  items: ReadonlyArray<ProposalOrderItem>,
  initial: RosterState,
  league: League,
): { readonly frees: number; readonly consumes: number } {
  let frees = 0;
  let consumes = 0;
  for (const item of items) {
    const change = itemPlaceAccounting(item, initial, league);
    frees += change.frees;
    consumes += change.consumes;
  }
  return { frees, consumes };
}

function netPlaceChange(
  items: ReadonlyArray<ProposalOrderItem>,
  initial: RosterState,
  league: League,
): number {
  const change = setPlaceAccounting(items, initial, league);
  return change.frees - change.consumes;
}

function rosterPlaceOf(
  item: ProposalOrderItem,
  initial: RosterState,
  league: League,
): ProposalOrderRosterPlace | undefined {
  const change = itemPlaceAccounting(item, initial, league);
  if (change.frees > change.consumes) {
    return "frees";
  }
  return change.consumes > change.frees ? "consumes" : undefined;
}

function itemPlaceAccounting(
  item: ProposalOrderItem,
  initial: RosterState,
  league: League,
): { readonly frees: number; readonly consumes: number } {
  if (item.move !== undefined) {
    return rosterPlaceChange(
      league.rule,
      initial.get(item.move.player.key)?.slot,
      item.move.toSlot,
    );
  }
  let frees = 0;
  for (const drop of item.drops) {
    frees += rosterPlaceChange(league.rule, initial.get(drop.key)?.slot, undefined).frees;
  }
  return { frees, consumes: item.adds.length };
}

function isLegal(state: RosterState, league: League): boolean {
  return placementFailure(state, league) === undefined;
}

function placementRefusal(state: RosterState, league: League): LineupRefusal | undefined {
  const problem: LineupProblem = {
    selectionBasis: neutralBasis,
    availabilityTiers: [neutralTier],
    slots: league.slots.map((slot) => slot.solver),
    players: [...state.values()].map((player) => solverPlayer(player, league, true)),
  };
  const solved = solveLineup(problem);
  return solved.kind === "plan" ? undefined : solved.refusal;
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
  return league.slots.some(
    (slot) =>
      slot.kind === "reserve" &&
      slotPlacement(league.rule, slot.position, player.positions).legal === true,
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
    players.map((player) => [
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

function illegalOccupant(state: RosterState, playerKey: string, league: League): boolean {
  const player = state.get(playerKey);
  return (
    player !== undefined &&
    player.slot !== undefined &&
    slotPlacement(league.rule, player.slot, player.positions).legal === false
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

function lockedReasons(
  item: ProposalOrderItem,
  players: ReadonlyArray<ProposalOrderPlayer>,
  timing: Timing,
): ReadonlyArray<ConflictReason> {
  if (item.move === undefined) {
    return [];
  }
  const player = players.find((entry) => entry.key === item.move?.player.key);
  if (player === undefined || player.editable) {
    return [];
  }
  return [
    {
      item: item.id,
      code: "move_locked",
      detail: `${item.label}: ${player.name} is locked, and the league applies roster changes ${timing.phrase}, so moving them to ${item.move.toSlot} cannot be legal ${timing.moment}.`,
    },
  ];
}

function waitingConflicts(
  waiting: ReadonlyArray<BlockedItem>,
  timing: Timing,
): ReadonlyArray<ProposalOrderPlanConflict> {
  if (waiting.length === 0) {
    return [];
  }
  return [
    {
      items: waiting.map((blocked) => blocked.entry.item.id),
      detail: `No operation can go first: ${waiting
        .map((blocked) => `${blocked.entry.item.label}: ${blocked.refusal.detail}`)
        .join(" ")} The set cannot be ordered ${timing.phrase}.`,
    },
  ];
}

function cycleConflicts(
  state: RosterState,
  cycle: ReadonlyArray<ProposalOrderItem>,
  league: League,
  timing: Timing,
): ReadonlyArray<ProposalOrderPlanConflict> {
  const conflicts: Array<ProposalOrderPlanConflict> = [];
  for (let left = 0; left < cycle.length; left += 1) {
    for (let right = left + 1; right < cycle.length; right += 1) {
      const first = cycle[left];
      const second = cycle[right];
      if (first === undefined || second === undefined || conflicts.length >= conflictLimit) {
        continue;
      }
      const one = applyDeclared(state, first, league);
      const two = applyDeclared(state, second, league);
      if (one.status !== "refused" || two.status !== "refused") {
        continue;
      }
      conflicts.push({
        items: [first.id, second.id],
        detail: `Neither operation can go first: ${one.detail} ${two.detail} ${pairSentence(timing)}`,
      });
    }
  }
  return conflicts;
}

function conflictWithReasons(
  items: ReadonlyArray<ProposalOrderItem>,
  reasons: ReadonlyArray<ConflictReason>,
  detail: string,
  timing: Timing,
): ProposalOrderPlanConflict {
  const summary = reasons.length === 0 ? detail : reasons.map((reason) => reason.detail).join(" ");
  return {
    items: items.map((item) => item.id),
    detail: summary === "" ? generalSentence(timing) : `${generalSentence(timing)} ${summary}`,
    ...(reasons.length === 0 ? {} : { reasons }),
  };
}

function itemRefusalConflict(refused: ReadonlyArray<BlockedItem>): ProposalOrderPlanConflict {
  return refusalConflict(
    refused.map((item) => ({
      item: item.entry.item.id,
      code: item.refusal.code,
      detail: `${item.entry.item.label}: ${item.refusal.detail}`,
    })),
  );
}

function refusalConflict(reasons: ReadonlyArray<ConflictReason>): ProposalOrderPlanConflict {
  return {
    items: reasons.map((reason) => reason.item),
    detail: reasons.map((reason) => reason.detail).join(" "),
    reasons,
  };
}

function strandedReasons(
  items: ReadonlyArray<ProposalOrderItem>,
  refusal: LineupRefusal,
  detail: string,
): ReadonlyArray<ConflictReason> {
  const playerIds =
    refusal.reason === "player-has-no-legal-slot" || refusal.reason === "no-legal-assignment"
      ? new Set(refusal.playerIds.map(String))
      : new Set<string>();
  return items.flatMap((item) =>
    item.adds.some((add) => playerIds.has(add.key))
      ? [{ item: item.id, code: "slot_illegal" as const, detail: `${item.label}: ${detail}` }]
      : [],
  );
}

function strandedDetail(
  state: RosterState,
  league: League,
  refusal: LineupRefusal,
  context?: RefusalContext,
): string {
  const key =
    refusal.reason === "player-has-no-legal-slot" || refusal.reason === "no-legal-assignment"
      ? String(refusal.playerIds[0])
      : undefined;
  const player = key === undefined ? undefined : state.get(key);
  const failure = placementFailure(state, league);
  if (refusal.reason === "required-starting-position-unfillable") {
    const slot = league.slots.find((entry) => entry.solver.id === refusal.slotId);
    const label = slot === undefined ? "A starting slot" : `The ${slotLabel(slot)}`;
    return `${label} is empty, and this league requires every starting slot to be filled. Add a player eligible for it, or move one there.`;
  }
  if (player === undefined) {
    return failure?.detail ?? "The roster cannot be made legal.";
  }
  const already =
    context !== undefined &&
    context.items.some((item) => freesPlace(context.initial, item, league));
  const occupancy = rosterOccupancy({ rule: league.rule, players: [...state.values()] });
  return `${player.name} cannot be placed on the roster: no open slot accepts their positions (${player.positions.join(", ")}). The team holds ${String(occupancy.occupied)} of ${String(occupancy.maximum)} roster places. ${
    already
      ? "This set's drops and slot moves do not leave a slot that accepts them."
      : "Add a drop for a player in a slot that accepts them, or a slot move that gives them a legal slot, to this set."
  }`;
}

function declaredMovers(items: ReadonlyArray<ProposalOrderItem>): ReadonlySet<string> {
  return new Set(items.flatMap((item) => (item.move === undefined ? [] : [item.move.player.key])));
}

function pairSentence(timing: Timing): string {
  return `The two operations cannot both be legal ${timing.phrase}.`;
}

function generalSentence(timing: Timing): string {
  return `No order of these operations keeps the lineup legal ${timing.phrase}.`;
}

function leagueOf(
  slots: ReadonlyArray<ProposalOrderSlot>,
  constraints: ProviderRosterConstraints,
): League {
  const rule = rosterRuleOf(constraints, slots);
  const leagueSlots = slots.map((slot) => ({ ...slot, solver: solverSlot(slot, rule) }));
  return {
    rule,
    slots: leagueSlots,
    byPosition: new Map(leagueSlots.map((slot) => [slot.position, slot] as const)),
  };
}

type Timing = {
  readonly rule: ProposalOrderTimingRule;
  readonly effectiveDate: string | undefined;
  readonly phrase: string;
  readonly moment: string;
};

function timingOf(input: ProposalOrderTiming): Timing {
  switch (input.rule) {
    case "same_day": {
      const date = input.currentDate;
      return {
        rule: "same_day",
        effectiveDate: date,
        phrase: datePhrase(date),
        moment: date === undefined ? "then" : "on that date",
      };
    }
    case "next_day": {
      const date =
        input.currentDate === undefined ? undefined : nextCalendarDate(input.currentDate);
      return {
        rule: "next_day",
        effectiveDate: date,
        phrase: datePhrase(date),
        moment: date === undefined ? "then" : "on that date",
      };
    }
    case "weekly_lock":
      return {
        rule: "weekly_lock",
        effectiveDate: undefined,
        phrase: "in the league's scoring week",
        moment: "in that week",
      };
    case undefined:
      return {
        rule: "not_published",
        effectiveDate: undefined,
        phrase: "when the league next applies roster changes",
        moment: "then",
      };
  }
}

function datePhrase(date: string | undefined): string {
  return date === undefined ? "when the league next applies roster changes" : `on ${date}`;
}

function nextCalendarDate(date: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    return undefined;
  }
  const parsed = DateTime.makeUnsafe(`${date}T00:00:00.000Z`);
  return DateTime.formatIsoDate(DateTime.add(parsed, { days: 1 }));
}

type Refusal = {
  readonly code: ProposalOrderRefusalCode;
  readonly detail: string;
};

type BlockedItem = {
  readonly entry: DeclaredItem;
  readonly refusal: Refusal;
};

type RefusalContext = {
  readonly items: ReadonlyArray<ProposalOrderItem>;
  readonly initial: RosterState;
};

type ConflictReason = {
  readonly item: string;
  readonly code: ProposalOrderRefusalCode;
  readonly detail: string;
};

type RosterMember = ProposalOrderPlayer;

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

export type ProposalOrderPlayer = {
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

type ProposalOrderMove = {
  readonly player: ProposalOrderPlayerRef;
  readonly toSlot: string;
};

export type ProposalOrderItem = {
  readonly id: string;
  readonly label: string;
  readonly adds: ReadonlyArray<ProposalOrderPlayerRef>;
  readonly drops: ReadonlyArray<ProposalOrderPlayerRef>;
  readonly move: ProposalOrderMove | undefined;
  readonly mayRepair: boolean;
};

type ProposalOrderTimingRule = "same_day" | "next_day" | "weekly_lock" | "not_published";

export type ProposalOrderTiming = {
  readonly rule: "same_day" | "next_day" | "weekly_lock" | undefined;
  readonly currentDate: string | undefined;
};

export type ProposalOrderInput = {
  readonly constraints: ProviderRosterConstraints;
  readonly slots: ReadonlyArray<ProposalOrderSlot>;
  readonly players: ReadonlyArray<ProposalOrderPlayer>;
  readonly timing: ProposalOrderTiming;
  readonly items: ReadonlyArray<ProposalOrderItem>;
};

type ProposalOrderRepair = {
  readonly playerKey: string;
  readonly playerName: string;
  readonly fromSlot: string;
  readonly toSlot: string;
};

type ProposalOrderPlanConflict = {
  readonly items: ReadonlyArray<string>;
  readonly detail: string;
  readonly reasons?: ReadonlyArray<ConflictReason>;
};

export type ProposalOrderRefusalCode =
  | "roster_full"
  | "slot_illegal"
  | "move_not_rostered"
  | "move_locked"
  | "move_slot_unknown"
  | "move_slot_full"
  | "drop_not_rostered"
  | "add_already_rostered"
  | "state_unavailable";

type CompositionRefusal = {
  readonly code: "roster_full" | "slot_illegal";
  readonly detail: string;
};

type ProposalOrderRosterPlace = "frees" | "consumes";

type ProposalOrderRosterPlaces = {
  readonly maximum: number;
  readonly occupied: number;
  readonly net: number;
};

export type ProposalOrderPlan =
  | {
      readonly status: "ordered";
      readonly timing: ProposalOrderTimingRule;
      readonly effectiveDate?: string;
      readonly rosterPlaces: ProposalOrderRosterPlaces;
      readonly steps: ReadonlyArray<{
        readonly item: string;
        readonly position: number;
        readonly rosterPlace?: ProposalOrderRosterPlace;
        readonly reserveMove?: OrderedRepair;
      }>;
    }
  | {
      readonly status: "conflict";
      readonly timing: ProposalOrderTimingRule;
      readonly effectiveDate?: string;
      readonly conflicts: ReadonlyArray<ProposalOrderPlanConflict>;
    }
  | {
      readonly status: "unresolved";
      readonly timing: ProposalOrderTimingRule;
      readonly effectiveDate?: string;
      readonly detail: string;
    };
