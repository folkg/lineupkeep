import {
  knownSelection,
  makeAvailabilityTier,
  makePlayerId,
  makeSelectionBasis,
  makeSlotId,
  playerMayOccupySlot,
  solveLineup,
} from "@lineupkeep/lineup-solver";
import type {
  LineupProblem,
  LineupRefusal,
  RosterPlayer,
  RosterSlot,
} from "@lineupkeep/lineup-solver";
import { DateTime } from "effect";

import { slotMismatchDetail } from "./RosterSlots.ts";

const conflictLimit = 3;
const neutralBasis = makeSelectionBasis("proposal-order");
const neutralTier = makeAvailabilityTier("proposal-order");

export function planProposalOrder(input: ProposalOrderInput): ProposalOrderPlan {
  const timing = timingOf(input.timing);
  const league = leagueOf(input.slots);
  const locked = input.items.flatMap((item) => lockedConflicts(item, input.players, timing));
  if (locked.length > 0) {
    return conflictPlan(timing, locked);
  }
  const ordered = orderSteps(input, league, timing);
  if (ordered.status === "conflict") {
    return conflictPlan(timing, ordered.conflicts);
  }
  return {
    status: "ordered",
    timing: timing.rule,
    ...(timing.effectiveDate === undefined ? {} : { effectiveDate: timing.effectiveDate }),
    steps: ordered.steps.map((step, position) => ({
      item: step.item.id,
      position,
      ...(step.reserveMove === undefined ? {} : { reserveMove: step.reserveMove }),
    })),
  };
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
  | { readonly status: "ordered"; readonly steps: ReadonlyArray<OrderedStep> }
  | { readonly status: "conflict"; readonly conflicts: ReadonlyArray<ProposalOrderPlanConflict> };

type OrderedStep = {
  readonly item: ProposalOrderItem;
  reserveMove?: ProposalOrderRepair;
};

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
    for (const entry of candidates) {
      const applied = applyDeclared(state, entry.item, league);
      if (applied.status === "refused") {
        continue;
      }
      if (awaitsPlace(state, entry.item, applied.state, items, league, declaredMoveKeys)) {
        continue;
      }
      chosen = { entry, state: applied.state };
      break;
    }
    if (chosen !== undefined) {
      state = chosen.state;
      let reserveMove = hold;
      hold = undefined;
      if (chosen.entry.item.mayRepair && reserveMove === undefined && !isLegal(state, league)) {
        const repaired = planRepair(state, league, blocked, declaredMoveKeys);
        if (repaired !== undefined) {
          state = repaired.state;
          reserveMove = repaired.repair;
        }
      }
      steps.push({
        item: chosen.entry.item,
        ...(reserveMove === undefined ? {} : { reserveMove }),
      });
      pending.splice(pending.indexOf(chosen.entry), 1);
      continue;
    }

    const cycle = findCycle(state, items, league);
    if (cycle === undefined) {
      return {
        status: "conflict",
        conflicts: schedulerConflicts(state, initial, input.items, items, league, timing),
      };
    }
    const planned = planHold(state, cycle, held, league);
    if (planned === undefined) {
      return { status: "conflict", conflicts: cycleConflicts(state, cycle, league, timing) };
    }
    state = relocate(state, planned.playerKey, planned.toSlot);
    held.add(planned.playerKey);
    hold = planned;
  }

  const failure = placementFailure(state, league);
  if (failure !== undefined) {
    return {
      status: "conflict",
      conflicts: [
        conflictWithReasons(
          input.items,
          itemReasons(initial, input.items, league, declaredMoveKeys),
          failure.detail,
          timing,
        ),
      ],
    };
  }
  const refusal = placementRefusal(state, league);
  if (refusal !== undefined) {
    const detail = strandedDetail(state, league, refusal);
    const reasons = itemReasons(initial, input.items, league, declaredMoveKeys);
    return {
      status: "conflict",
      conflicts: [
        conflictWithReasons(
          input.items,
          reasons.length > 0 ? reasons : strandedReasons(input.items, refusal, detail),
          detail,
          timing,
        ),
      ],
    };
  }
  return { status: "ordered", steps };
}

function awaitsPlace(
  state: RosterState,
  item: ProposalOrderItem,
  applied: RosterState,
  pending: ReadonlyArray<ProposalOrderItem>,
  league: League,
  declaredMoveKeys: ReadonlySet<string>,
): boolean {
  if (item.adds.length === 0) {
    return false;
  }
  if (placementFailure(applied, league)?.code !== "roster_full") {
    return false;
  }
  const blocked = new Set([
    ...declaredMoveKeys,
    ...item.adds.map((add) => add.key),
    ...item.drops.map((drop) => drop.key),
  ]);
  if (item.mayRepair && planRepair(applied, league, blocked, declaredMoveKeys) !== undefined) {
    return false;
  }
  return pending.some((other) => other !== item && freesPlace(state, other, league));
}

function freesPlace(state: RosterState, item: ProposalOrderItem, league: League): boolean {
  if (item.drops.some((drop) => !inReserve(state.get(drop.key), league))) {
    return true;
  }
  const mover = item.move === undefined ? undefined : state.get(item.move.player.key);
  const destination = item.move === undefined ? undefined : league.byPosition.get(item.move.toSlot);
  return destination?.kind === "reserve" && mover?.slot !== undefined && !inReserve(mover, league);
}

function inReserve(player: RosterMember | undefined, league: League): boolean {
  const slot = player?.slot === undefined ? undefined : league.byPosition.get(player.slot);
  return slot?.kind === "reserve";
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
    if (destination === undefined || slot === undefined) {
      continue;
    }
    if (occupancyOf(state, destination) < slot.count) {
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
        occupancyOf(state, slot.position) < slot.count &&
        playerMayOccupySlot(solverPlayer(player, league, false), slot.solver),
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
        `The provider reports no verified slot for ${moving.name}, so the move cannot be planned.`,
      );
    }
    const slot = league.byPosition.get(item.move.toSlot);
    if (slot === undefined) {
      return refused(
        "move_slot_unknown",
        `The league does not declare a ${item.move.toSlot} slot, so ${moving.name} cannot move there.`,
      );
    }
    if (!playerMayOccupySlot(solverPlayer(moving, league, false), slot.solver)) {
      return refused(
        "slot_illegal",
        `${moving.name} is not eligible for the ${slot.position} slot: it does not accept their positions (${moving.positions.join(", ")}).`,
      );
    }
    const occupants = occupancyOf(next, slot.position);
    if (occupants >= slot.count) {
      return refused(
        "move_slot_full",
        `Moving ${moving.name} to ${slot.position} needs a free ${slot.position} slot, and ${slot.count === 1 ? "it is full" : `${String(occupants)} of ${String(slot.count)} are occupied`}.`,
      );
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

function itemRefusal(
  state: RosterState,
  item: ProposalOrderItem,
  league: League,
  declaredMoveKeys: ReadonlySet<string>,
): Refusal | undefined {
  const applied = applyDeclared(state, item, league);
  if (applied.status === "refused") {
    return applied;
  }
  const failure = placementFailure(applied.state, league);
  if (failure === undefined) {
    return undefined;
  }
  if (item.mayRepair) {
    const blocked = new Set([
      ...declaredMoveKeys,
      ...item.adds.map((add) => add.key),
      ...item.drops.map((drop) => drop.key),
    ]);
    if (planRepair(applied.state, league, blocked, declaredMoveKeys) !== undefined) {
      return undefined;
    }
  }
  return failure;
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
      playerMayOccupySlot(solverPlayer(player, league, false), slot.solver)
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
    .filter(
      (slot) =>
        slot.position !== player.slot &&
        occupancyOf(state, slot.position) < slot.count &&
        playerMayOccupySlot(solverPlayer(player, league, false), slot.solver),
    )
    .sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind]);
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

function placementFailure(state: RosterState, league: League): CompositionRefusal | undefined {
  const occupancy = new Map<string, number>();
  let nonReserve = 0;
  let illegal: RosterMember | undefined;
  for (const player of state.values()) {
    if (player.slot === undefined) {
      nonReserve += 1;
      continue;
    }
    const slot = league.byPosition.get(player.slot);
    if (slot === undefined) {
      nonReserve += 1;
      continue;
    }
    if (
      illegal === undefined &&
      !playerMayOccupySlot(solverPlayer(player, league, false), slot.solver)
    ) {
      illegal = player;
    }
    occupancy.set(slot.position, (occupancy.get(slot.position) ?? 0) + 1);
    if (slot.kind !== "reserve") {
      nonReserve += 1;
    }
  }
  if (nonReserve > league.capacity) {
    return {
      code: "roster_full",
      detail: `The team would hold ${String(nonReserve)} players outside its reserve slots, but the league allows ${String(league.capacity)}. Add a drop item for a player outside a reserve slot, or a slot move into a reserve slot, to this set.`,
    };
  }
  if (illegal?.slot !== undefined) {
    return {
      code: "slot_illegal",
      detail: `${slotMismatchDetail({ name: illegal.name, slot: illegal.slot, positions: illegal.positions })} No open slot accepts them, and choosing which player to drop is yours. Add that drop to this set, or add a slot move that gives them a legal slot.`,
    };
  }
  for (const [position, count] of occupancy) {
    const slot = league.byPosition.get(position);
    if (slot !== undefined && count > slot.count) {
      return {
        code: "slot_illegal",
        detail: `The ${position} slot holds ${String(count)} players, but the league allows ${String(slot.count)}. Add a move that resolves it to this set.`,
      };
    }
  }
  return undefined;
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
    reserveEligible: !pin || slot !== undefined ? reserveEligible(player, league) : false,
    lockedSlotId: pin && slot !== undefined ? makeSlotId(slot.position) : undefined,
    currentSlotId: slot === undefined ? undefined : makeSlotId(slot.position),
    mayBeLeftInPlace: false,
  };
}

function reserveEligible(player: RosterMember, league: League): boolean {
  return (
    league.reserveAcceptsAny ||
    league.reserveMarkers.some((marker) => player.positions.includes(marker))
  );
}

function solverSlot(slot: ProposalOrderSlot): RosterSlot {
  const id = makeSlotId(slot.position);
  const eligibility =
    slot.eligibility.length === 0
      ? ({ kind: "any" } as const)
      : ({ kind: "positions", positions: [...slot.eligibility] } as const);
  return slot.kind === "starting"
    ? { kind: "starting", id, capacity: slot.count, requirement: "optional", eligibility }
    : { kind: slot.kind, id, capacity: slot.count, eligibility };
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
  const slot = player?.slot === undefined ? undefined : league.byPosition.get(player.slot);
  return (
    player !== undefined &&
    slot !== undefined &&
    !playerMayOccupySlot(solverPlayer(player, league, false), slot.solver)
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

function lockedConflicts(
  item: ProposalOrderItem,
  players: ReadonlyArray<ProposalOrderPlayer>,
  timing: Timing,
): ReadonlyArray<ProposalOrderPlanConflict> {
  if (item.move === undefined) {
    return [];
  }
  const player = players.find((entry) => entry.key === item.move?.player.key);
  if (player === undefined || player.editable) {
    return [];
  }
  return [
    {
      items: [item.id],
      detail: `${player.name} is locked, and the league applies roster changes ${timing.phrase}, so moving them to ${item.move.toSlot} cannot be legal ${timing.moment}.`,
    },
  ];
}

function schedulerConflicts(
  state: RosterState,
  initial: RosterState,
  items: ReadonlyArray<ProposalOrderItem>,
  pending: ReadonlyArray<ProposalOrderItem>,
  league: League,
  timing: Timing,
): ReadonlyArray<ProposalOrderPlanConflict> {
  const blocked = pending.flatMap((item) => {
    const applied = applyDeclared(state, item, league);
    return applied.status === "refused" &&
      item.move !== undefined &&
      applied.code === "move_slot_full"
      ? [{ item, detail: applied.detail }]
      : [];
  });
  const conflicts: Array<ProposalOrderPlanConflict> = [];
  for (const entry of blocked) {
    if (conflicts.length >= conflictLimit) {
      break;
    }
    const destination = entry.item.move?.toSlot;
    if (destination === undefined) {
      continue;
    }
    const competitors = items.filter(
      (other) => other !== entry.item && other.move?.toSlot === destination,
    );
    if (competitors.length > 0) {
      conflicts.push({
        items: [entry.item.id, ...competitors.map((other) => other.id)],
        detail: `${entry.detail} ${pairSentence(timing)}`,
      });
      continue;
    }
    const drops = items.filter(
      (other) =>
        other !== entry.item &&
        other.drops.some((drop) => {
          const player = initial.get(drop.key);
          return player !== undefined && player.slot !== destination;
        }),
    );
    if (drops.length === 0) {
      conflicts.push({
        items: [entry.item.id],
        detail: `${entry.detail} ${generalSentence(timing)}`,
      });
      continue;
    }
    for (const drop of drops) {
      if (conflicts.length >= conflictLimit) {
        break;
      }
      const note = freedSlotNote(entry.item, drop, initial);
      conflicts.push({
        items: [entry.item.id, drop.id],
        detail: `${entry.detail}${note === undefined ? "" : ` ${note}`} ${pairSentence(timing)}`,
      });
    }
  }
  return conflicts.length > 0
    ? conflicts
    : [conflictWithReasons(pending, itemReasons(state, pending, league), "", timing)];
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

function itemReasons(
  initial: RosterState,
  items: ReadonlyArray<ProposalOrderItem>,
  league: League,
  declaredMoveKeys: ReadonlySet<string> = declaredMovers(items),
): ReadonlyArray<ConflictReason> {
  return items.flatMap((item) => {
    const refused = itemRefusal(initial, item, league, declaredMoveKeys);
    return refused === undefined
      ? []
      : [{ item: item.id, code: refused.code, detail: `${item.label}: ${refused.detail}` }];
  });
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
      ? [{ item: item.id, code: "slot_illegal" as const, detail }]
      : [],
  );
}

function strandedDetail(state: RosterState, league: League, refusal: LineupRefusal): string {
  const key =
    refusal.reason === "player-has-no-legal-slot" || refusal.reason === "no-legal-assignment"
      ? String(refusal.playerIds[0])
      : undefined;
  const player = key === undefined ? undefined : state.get(key);
  const failure = placementFailure(state, league);
  if (player === undefined) {
    return failure?.detail ?? "The roster cannot be made legal.";
  }
  return `${player.name} cannot be placed in any open slot in this league: no open slot accepts their positions (${player.positions.join(", ")}). Add a drop item for a player in a slot that accepts them, or a slot move that gives them a legal slot, to this set.`;
}

function declaredMovers(items: ReadonlyArray<ProposalOrderItem>): ReadonlySet<string> {
  return new Set(items.flatMap((item) => (item.move === undefined ? [] : [item.move.player.key])));
}

function freedSlotNote(
  moveItem: ProposalOrderItem,
  dropItem: ProposalOrderItem,
  initial: RosterState,
): string | undefined {
  if (moveItem.move === undefined || dropItem.drops.length === 0) {
    return undefined;
  }
  const destination = moveItem.move.toSlot;
  const freed = dropItem.drops.flatMap((drop) => {
    const player = initial.get(drop.key);
    return player?.slot === undefined || player.slot === destination ? [] : [player.slot];
  });
  const slots = [...new Set(freed)];
  if (slots.length === 0) {
    return undefined;
  }
  const names = dropItem.drops.map((drop) => drop.name).join(", ");
  const slotPhrase =
    slots.length === 1
      ? `the ${String(slots[0])} slot`
      : `the ${slots.slice(0, -1).join(", ")} and ${String(slots[slots.length - 1])} slots`;
  return `Dropping ${names} frees ${slotPhrase}, not ${destination}.`;
}

function pairSentence(timing: Timing): string {
  return `The two operations cannot both be legal ${timing.phrase}.`;
}

function generalSentence(timing: Timing): string {
  return `No order of these operations keeps the lineup legal ${timing.phrase}.`;
}

function leagueOf(slots: ReadonlyArray<ProposalOrderSlot>): League {
  const leagueSlots = slots.map((slot) => ({ ...slot, solver: solverSlot(slot) }));
  return {
    slots: leagueSlots,
    byPosition: new Map(leagueSlots.map((slot) => [slot.position, slot])),
    reserveMarkers: slots.flatMap((slot) => (slot.kind === "reserve" ? [...slot.eligibility] : [])),
    reserveAcceptsAny: slots.some(
      (slot) => slot.kind === "reserve" && slot.eligibility.length === 0,
    ),
    capacity: slots.reduce(
      (total, slot) => (slot.kind === "reserve" ? total : total + slot.count),
      0,
    ),
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

type ConflictReason = {
  readonly item: string;
  readonly code: ProposalOrderRefusalCode;
  readonly detail: string;
};

type RosterMember = ProposalOrderPlayer;

type RosterState = ReadonlyMap<string, RosterMember>;

type LeagueSlot = ProposalOrderSlot & { readonly solver: RosterSlot };

type League = {
  readonly slots: ReadonlyArray<LeagueSlot>;
  readonly byPosition: ReadonlyMap<string, LeagueSlot>;
  readonly reserveMarkers: ReadonlyArray<string>;
  readonly reserveAcceptsAny: boolean;
  readonly capacity: number;
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

type ProposalOrderTiming = {
  readonly rule: "same_day" | "next_day" | "weekly_lock" | undefined;
  readonly currentDate: string | undefined;
};

export type ProposalOrderInput = {
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

type ProposalOrderRefusalCode =
  | "roster_full"
  | "slot_illegal"
  | "move_not_rostered"
  | "move_locked"
  | "move_slot_unknown"
  | "move_slot_full"
  | "drop_not_rostered"
  | "add_already_rostered";

type CompositionRefusal = {
  readonly code: "roster_full" | "slot_illegal";
  readonly detail: string;
};

export type ProposalOrderPlan =
  | {
      readonly status: "ordered";
      readonly timing: ProposalOrderTimingRule;
      readonly effectiveDate?: string;
      readonly steps: ReadonlyArray<{
        readonly item: string;
        readonly position: number;
        readonly reserveMove?: ProposalOrderRepair;
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
