import { DateTime } from "effect";

import { slotAcceptsPositions, slotMismatchDetail } from "./RosterSlots.ts";

const searchLimit = 20_000;
const conflictLimit = 3;

const exhausted = Symbol("exhausted");

export function planProposalOrder(input: ProposalOrderInput): ProposalOrderPlan {
  const slots = new Map(input.slots.map((slot) => [slot.position, slot] as const));
  const timing = timingOf(input.timing);
  const initial = initialState(input.players);
  const declaredMoveKeys = new Set(
    input.items.flatMap((item) => (item.move === undefined ? [] : [item.move.player.key])),
  );
  const locked = input.items.flatMap((item) => lockedConflicts(item, input.players, timing));
  if (locked.length > 0) {
    return {
      status: "conflict",
      timing: timing.rule,
      ...(timing.effectiveDate === undefined ? {} : { effectiveDate: timing.effectiveDate }),
      conflicts: locked,
    };
  }
  const searched = searchOrder(initial, input.items, slots, timing, declaredMoveKeys);
  switch (searched.status) {
    case "ordered":
      return {
        status: "ordered",
        timing: timing.rule,
        ...(timing.effectiveDate === undefined ? {} : { effectiveDate: timing.effectiveDate }),
        steps: searched.steps.map((step, position) => ({
          item: step.item,
          position,
          ...(step.repair === undefined ? {} : { reserveMove: step.repair }),
        })),
      };
    case "exhausted":
      return {
        status: "unresolved",
        timing: timing.rule,
        ...(timing.effectiveDate === undefined ? {} : { effectiveDate: timing.effectiveDate }),
        detail: `The server stopped after checking ${searchLimit.toLocaleString("en-US")} possible arrangements without finding an order that keeps the team legal. That is not proof that no order exists. Split the set into smaller proposals and try again.`,
      };
    case "impossible":
      return {
        status: "conflict",
        timing: timing.rule,
        ...(timing.effectiveDate === undefined ? {} : { effectiveDate: timing.effectiveDate }),
        conflicts: explainConflicts(initial, input.items, slots, timing, declaredMoveKeys),
      };
  }
}

type OrderedStep = {
  readonly item: string;
  readonly repair?: ProposalOrderRepair;
};

type SearchResult =
  | { readonly status: "ordered"; readonly steps: ReadonlyArray<OrderedStep> }
  | { readonly status: "impossible" }
  | { readonly status: "exhausted" };

function searchOrder(
  initial: RosterState,
  items: ReadonlyArray<ProposalOrderItem>,
  slots: SlotMap,
  timing: Timing,
  declaredMoveKeys: ReadonlySet<string>,
): SearchResult {
  const failed = new Set<string>();
  const visited = { count: 0 };

  function visit(
    state: RosterState,
    remaining: ReadonlyArray<ProposalOrderItem>,
  ): OrderedStep[] | typeof exhausted | undefined {
    if (remaining.length === 0) {
      return isLegal(state, slots) ? [] : undefined;
    }
    const key = memoKey(state, remaining);
    if (failed.has(key)) {
      return undefined;
    }
    visited.count += 1;
    if (visited.count > searchLimit) {
      return exhausted;
    }
    for (const [index, item] of remaining.entries()) {
      const applied = applyItem(state, item, slots, timing, declaredMoveKeys);
      if (applied.status === "refused" || !isLegal(applied.state, slots)) {
        continue;
      }
      const rest = [...remaining.slice(0, index), ...remaining.slice(index + 1)];
      const steps = visit(applied.state, rest);
      if (steps === exhausted) {
        return exhausted;
      }
      if (steps !== undefined) {
        return [
          {
            item: item.id,
            ...(applied.repair === undefined ? {} : { repair: applied.repair }),
          },
          ...steps,
        ];
      }
    }
    failed.add(key);
    return undefined;
  }

  const steps = visit(initial, items);
  if (steps === exhausted) {
    return { status: "exhausted" };
  }
  return steps === undefined ? { status: "impossible" } : { status: "ordered", steps };
}

function memoKey(state: RosterState, remaining: ReadonlyArray<ProposalOrderItem>): string {
  const roster = [...state.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((player) => `${player.key}=${player.slot ?? "unverified"}`)
    .join("|");
  return `${remaining
    .map((item) => item.id)
    .sort()
    .join(",")}#${roster}`;
}

type Application =
  | {
      readonly status: "applied";
      readonly state: RosterState;
      readonly repair?: ProposalOrderRepair;
    }
  | {
      readonly status: "refused";
      readonly code: ProposalOrderRefusalCode;
      readonly detail: string;
    };

function applyItem(
  state: RosterState,
  item: ProposalOrderItem,
  slots: SlotMap,
  timing: Timing,
  declaredMoveKeys: ReadonlySet<string>,
): Application {
  const next = new Map(state);
  if (item.move !== undefined) {
    const moving = next.get(item.move.player.key);
    if (moving === undefined) {
      return {
        status: "refused",
        code: "move_not_rostered",
        detail: `${item.move.player.name} is no longer on the roster, so the move cannot be made.`,
      };
    }
    if (moving.slot === undefined) {
      return {
        status: "refused",
        code: "slot_illegal",
        detail: `The provider reports no verified slot for ${moving.name}, so the move cannot be planned.`,
      };
    }
    if (!moving.editable) {
      return {
        status: "refused",
        code: "move_locked",
        detail: `${moving.name} is locked, and the league applies roster changes ${timing.phrase}, so moving them to ${item.move.toSlot} cannot be legal ${timing.moment}.`,
      };
    }
    const slot = slots.get(item.move.toSlot);
    if (slot === undefined) {
      return {
        status: "refused",
        code: "move_slot_unknown",
        detail: `The league does not declare a ${item.move.toSlot} slot, so ${moving.name} cannot move there.`,
      };
    }
    if (!slotAcceptsPositions(slot.eligibility, moving.positions)) {
      return {
        status: "refused",
        code: "slot_illegal",
        detail: `${moving.name} is not eligible for the ${slot.position} slot: it does not accept their positions (${moving.positions.join(", ")}).`,
      };
    }
    const occupants = occupancyOf(next, slot.position);
    if (occupants >= slot.count) {
      return {
        status: "refused",
        code: "move_slot_full",
        detail: `Moving ${moving.name} to ${slot.position} needs a free ${slot.position} slot, and ${slot.count === 1 ? "it is full" : `${String(occupants)} of ${String(slot.count)} are occupied`}.`,
      };
    }
    next.set(moving.key, { ...moving, slot: slot.position });
  }
  for (const drop of item.drops) {
    const dropped = next.get(drop.key);
    if (dropped === undefined) {
      return {
        status: "refused",
        code: "drop_not_rostered",
        detail: `${drop.name} is no longer on the roster, so the drop cannot be made.`,
      };
    }
    next.delete(dropped.key);
  }
  for (const add of item.adds) {
    if (next.has(add.key)) {
      return {
        status: "refused",
        code: "add_already_rostered",
        detail: `${add.name} is already on the roster, so the add cannot be made.`,
      };
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
  if (isLegal(next, slots)) {
    return { status: "applied", state: next };
  }
  if (!item.mayRepair) {
    return { status: "refused", ...compositionRefusal(next, slots) };
  }
  const repaired = planRepair(next, slots, item, declaredMoveKeys);
  return repaired === undefined
    ? { status: "refused", ...compositionRefusal(next, slots) }
    : { status: "applied", state: repaired.state, repair: repaired.repair };
}

function planRepair(
  state: RosterState,
  slots: SlotMap,
  item: ProposalOrderItem,
  declaredMoveKeys: ReadonlySet<string>,
): { readonly state: RosterState; readonly repair: ProposalOrderRepair } | undefined {
  for (const player of state.values()) {
    if (player.slot === undefined || !player.editable) {
      continue;
    }
    const slot = slots.get(player.slot);
    if (slot === undefined || slotAcceptsPositions(slot.eligibility, player.positions)) {
      continue;
    }
    for (const destination of openDestinations(state, slots, player)) {
      const repaired = relocate(state, player.key, destination);
      if (isLegal(repaired, slots)) {
        return { state: repaired, repair: repairOf(player, player.slot, destination) };
      }
    }
  }
  const blocked = new Set([
    ...item.adds.map((add) => add.key),
    ...item.drops.map((drop) => drop.key),
    ...declaredMoveKeys,
  ]);
  const candidates = [...state.values()]
    .filter((player) => {
      if (player.slot === undefined || !player.editable || blocked.has(player.key)) {
        return false;
      }
      const slot = slots.get(player.slot);
      return slot !== undefined && slot.kind !== "reserve";
    })
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
    for (const destination of openDestinations(state, slots, player)) {
      if (slots.get(destination)?.kind !== "reserve") {
        continue;
      }
      const repaired = relocate(state, player.key, destination);
      if (isLegal(repaired, slots)) {
        return { state: repaired, repair: repairOf(player, player.slot, destination) };
      }
    }
  }
  return undefined;
}

function openDestinations(
  state: RosterState,
  slots: SlotMap,
  player: RosterMember,
): ReadonlyArray<string> {
  const kindOrder = { bench: 0, starting: 1, reserve: 2 } as const;
  return [...slots.values()]
    .filter(
      (slot) =>
        slot.position !== player.slot &&
        slotAcceptsPositions(slot.eligibility, player.positions) &&
        occupancyOf(state, slot.position) < slot.count,
    )
    .sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind])
    .map((slot) => slot.position);
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

function compositionRefusal(state: RosterState, slots: SlotMap): CompositionRefusal {
  const capacity = capacityOf(slots);
  let nonReserve = 0;
  let illegalPlacement: { readonly player: RosterMember; readonly slot: string } | undefined;
  for (const player of state.values()) {
    if (player.slot === undefined) {
      nonReserve += 1;
      continue;
    }
    const slot = slots.get(player.slot);
    if (slot === undefined) {
      nonReserve += 1;
      continue;
    }
    if (
      illegalPlacement === undefined &&
      !slotAcceptsPositions(slot.eligibility, player.positions)
    ) {
      illegalPlacement = { player, slot: slot.position };
    }
    if (slot.kind !== "reserve") {
      nonReserve += 1;
    }
  }
  if (nonReserve > capacity) {
    return {
      code: "roster_full",
      detail: `The team would hold ${String(nonReserve)} players outside its reserve slots, but the league allows ${String(capacity)}. Add a drop item for a player outside a reserve slot, or a slot move into a reserve slot, to this set.`,
    };
  }
  if (illegalPlacement !== undefined) {
    const { player, slot } = illegalPlacement;
    return {
      code: "slot_illegal",
      detail: `${slotMismatchDetail({ name: player.name, slot, positions: player.positions })} No open slot accepts them, and choosing which player to drop is yours. Add that drop to this set, or add a slot move that gives them a legal slot.`,
    };
  }
  return {
    code: "slot_illegal",
    detail: `${illegalDetail(state, slots) ?? "The roster cannot be made legal."} Add a move that resolves it to this set.`,
  };
}

function capacityOf(slots: SlotMap): number {
  return [...slots.values()].reduce(
    (total, slot) => (slot.kind === "reserve" ? total : total + slot.count),
    0,
  );
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

function isLegal(state: RosterState, slots: SlotMap): boolean {
  return illegalDetail(state, slots) === undefined;
}

function illegalDetail(state: RosterState, slots: SlotMap): string | undefined {
  const occupancy = new Map<string, number>();
  let nonReserve = 0;
  for (const player of state.values()) {
    if (player.slot === undefined) {
      nonReserve += 1;
      continue;
    }
    const slot = slots.get(player.slot);
    if (slot === undefined) {
      nonReserve += 1;
      continue;
    }
    if (!slotAcceptsPositions(slot.eligibility, player.positions)) {
      return slotMismatchDetail({
        name: player.name,
        slot: slot.position,
        positions: player.positions,
      });
    }
    occupancy.set(slot.position, (occupancy.get(slot.position) ?? 0) + 1);
    if (slot.kind !== "reserve") {
      nonReserve += 1;
    }
  }
  for (const [position, count] of occupancy) {
    const slot = slots.get(position);
    if (slot !== undefined && count > slot.count) {
      return `The ${position} slot holds ${String(count)} players, but the league allows ${String(slot.count)}.`;
    }
  }
  const capacity = [...slots.values()].reduce(
    (total, slot) => (slot.kind === "reserve" ? total : total + slot.count),
    0,
  );
  return nonReserve > capacity
    ? `The team holds ${String(nonReserve)} players outside its reserve slots, but the league allows ${String(capacity)}.`
    : undefined;
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

type Simulation =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly item: ProposalOrderItem;
      readonly code: ProposalOrderRefusalCode;
      readonly detail: string;
    };

function simulatePair(
  initial: RosterState,
  pair: readonly [ProposalOrderItem, ProposalOrderItem],
  slots: SlotMap,
  timing: Timing,
  declaredMoveKeys: ReadonlySet<string>,
): Simulation {
  let state = initial;
  for (const item of pair) {
    const applied = applyItem(state, item, slots, timing, declaredMoveKeys);
    if (applied.status === "refused") {
      return { valid: false, item, code: applied.code, detail: applied.detail };
    }
    const illegal = illegalDetail(applied.state, slots);
    if (illegal !== undefined) {
      return { valid: false, item, code: "slot_illegal", detail: illegal };
    }
    state = applied.state;
  }
  return { valid: true };
}

function explainConflicts(
  initial: RosterState,
  items: ReadonlyArray<ProposalOrderItem>,
  slots: SlotMap,
  timing: Timing,
  declaredMoveKeys: ReadonlySet<string>,
): ReadonlyArray<ProposalOrderPlanConflict> {
  const pairs: Array<ProposalOrderPlanConflict> = [];
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      const first = items[left];
      const second = items[right];
      if (first === undefined || second === undefined) {
        continue;
      }
      const forward = simulatePair(initial, [first, second], slots, timing, declaredMoveKeys);
      const backward = simulatePair(initial, [second, first], slots, timing, declaredMoveKeys);
      if (forward.valid || backward.valid) {
        continue;
      }
      pairs.push({
        items: [first.id, second.id],
        detail: pairDetail({
          first,
          second,
          forward,
          backward,
          initial,
          timing,
        }),
        ...pairReasons(first, second, forward, backward),
      });
      if (pairs.length >= conflictLimit) {
        return pairs;
      }
    }
  }
  if (pairs.length > 0) {
    return pairs;
  }
  return [generalConflict(initial, items, slots, timing, declaredMoveKeys)];
}

function pairReasons(
  first: ProposalOrderItem,
  second: ProposalOrderItem,
  forward: Simulation,
  backward: Simulation,
): {
  readonly reasons?: ReadonlyArray<{
    readonly item: string;
    readonly code: ProposalOrderRefusalCode;
    readonly detail: string;
  }>;
} {
  const reasons = new Map<
    string,
    { readonly code: ProposalOrderRefusalCode; readonly detail: string }
  >();
  if (!forward.valid && forward.item === second && forward.code === "roster_full") {
    reasons.set(second.id, { code: forward.code, detail: forward.detail });
  }
  if (!backward.valid && backward.item === first && backward.code === "roster_full") {
    reasons.set(first.id, { code: backward.code, detail: backward.detail });
  }
  return reasons.size === 0
    ? {}
    : {
        reasons: [...reasons.entries()].map(([item, reason]) => ({
          item,
          code: reason.code,
          detail: reason.detail,
        })),
      };
}

function pairDetail(input: {
  readonly first: ProposalOrderItem;
  readonly second: ProposalOrderItem;
  readonly forward: Simulation;
  readonly backward: Simulation;
  readonly initial: RosterState;
  readonly timing: Timing;
}): string {
  const { forward, backward } = input;
  const forwardFailedFirst = !forward.valid && forward.item === input.first;
  const backwardFailedFirst = !backward.valid && backward.item === input.second;
  if (forwardFailedFirst && backwardFailedFirst) {
    return `Neither operation can go first: ${forward.detail} ${backward.detail} The two operations cannot both be legal ${input.timing.phrase}.`;
  }
  const blocked =
    !forward.valid && forward.item === input.second
      ? forward
      : !backward.valid && backward.item === input.first
        ? backward
        : forward;
  if (blocked.valid) {
    return `The two operations cannot both be legal ${input.timing.phrase}.`;
  }
  const note = freedSlotNote(input);
  return `${blocked.detail}${note === undefined ? "" : ` ${note}`} The two operations cannot both be legal ${input.timing.phrase}.`;
}

function freedSlotNote(input: {
  readonly first: ProposalOrderItem;
  readonly second: ProposalOrderItem;
  readonly initial: RosterState;
}): string | undefined {
  for (const [mover, other] of [
    [input.first, input.second],
    [input.second, input.first],
  ] as const) {
    if (mover.move === undefined || other.drops.length === 0) {
      continue;
    }
    const destination = mover.move.toSlot;
    const freed = other.drops.flatMap((drop) => {
      const player = input.initial.get(drop.key);
      return player?.slot === undefined || player.slot === destination ? [] : [player.slot];
    });
    const slots = [...new Set(freed)];
    if (slots.length > 0) {
      const names = other.drops.map((drop) => drop.name).join(", ");
      const slotPhrase =
        slots.length === 1
          ? `the ${String(slots[0])} slot`
          : `the ${slots.slice(0, -1).join(", ")} and ${String(slots[slots.length - 1])} slots`;
      return `Dropping ${names} frees ${slotPhrase}, not ${destination}.`;
    }
  }
  return undefined;
}

function generalConflict(
  initial: RosterState,
  items: ReadonlyArray<ProposalOrderItem>,
  slots: SlotMap,
  timing: Timing,
  declaredMoveKeys: ReadonlySet<string>,
): ProposalOrderPlanConflict {
  const reasons = items.flatMap((item) => {
    const applied = applyItem(initial, item, slots, timing, declaredMoveKeys);
    if (applied.status === "refused") {
      return [
        {
          item: item.id,
          code: applied.code,
          label: `${item.label}: ${applied.detail}`,
        },
      ];
    }
    const illegal = illegalDetail(applied.state, slots);
    return illegal === undefined
      ? []
      : [
          {
            item: item.id,
            code: "slot_illegal" as const,
            label: `${item.label} leaves the team illegal: ${illegal}`,
          },
        ];
  });
  const detail =
    reasons.length === 0
      ? `No order of these operations keeps the lineup legal ${timing.phrase}.`
      : `No order of these operations keeps the lineup legal ${timing.phrase}. ${reasons
          .map((reason) => reason.label)
          .join(" ")}`;
  return {
    items: items.map((item) => item.id),
    detail,
    ...(reasons.length === 0
      ? {}
      : {
          reasons: reasons.map((reason) => ({
            item: reason.item,
            code: reason.code,
            detail: reason.label,
          })),
        }),
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

type RosterMember = ProposalOrderPlayer;

type RosterState = ReadonlyMap<string, RosterMember>;

type SlotMap = ReadonlyMap<string, ProposalOrderSlot>;

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
  readonly reasons?: ReadonlyArray<{
    readonly item: string;
    readonly code: ProposalOrderRefusalCode;
    readonly detail: string;
  }>;
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
