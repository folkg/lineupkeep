import { Effect } from "effect";
import { Schema } from "effect";
import { Array as EffectArray } from "effect";
import { Option as EffectOption } from "effect";

import { rosterOccupancy, slotPlacement } from "#contexts/connections/RosterSlots.ts";
import type { RosterRule } from "#contexts/connections/RosterSlots.ts";

import { planRosterPlacement } from "./LineupPlanning.ts";
import type { RosterPlacementMove } from "./LineupPlanning.ts";
import { describeTransactionPlanMove } from "./TransactionPlanEvaluation.ts";
import type {
  TransactionPlanMove,
  TransactionPlanRosterPlayer,
  TransactionPlanTeamFacts,
} from "./TransactionPlanEvaluation.ts";
import { TransactionMoveId } from "./TransactionPlanRecord.ts";
import type { StoredMoveValidationReason } from "./TransactionPlanRecord.ts";

function arrayValueIsArray<A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> {
  return EffectArray.isArray(value);
}

const rosterFixGroupPrefix = "roster-fixes:";

export const rosterFixLabel = "Roster fixes";

export function rosterFixGroupOf(move: TransactionMoveId): string {
  return `${rosterFixGroupPrefix}${move}`;
}

export function isRosterFixGroup(group: string | undefined): boolean {
  return group !== undefined && group.startsWith(rosterFixGroupPrefix);
}

export function rosterFixFundedMove(group: string | undefined): TransactionMoveId | undefined {
  if (group === undefined || !isRosterFixGroup(group)) {
    return undefined;
  }
  return Effect.runSync(
    Schema.decodeEffect(TransactionMoveId)(group.slice(rosterFixGroupPrefix.length)),
  );
}

export function searchRosterFixes(input: {
  readonly facts: TransactionPlanTeamFacts;
  readonly rule: RosterRule;
  readonly funded: TransactionPlanMove;
  readonly reasons: ReadonlyArray<StoredMoveValidationReason>;
}): RosterFixSearch {
  if (
    !EffectArray.some(
      input.reasons,
      (reason) => reason.code === "roster_full" || reason.code === "slot_illegal",
    )
  ) {
    return { fixes: [], detail: undefined };
  }
  const roster = EffectArray.filter(
    input.facts.roster,
    (player) => !EffectArray.some(input.funded.drops, (drop) => drop.key === player.key),
  );
  const occupancy = rosterOccupancy({ rule: input.rule, players: roster });
  const needsPlace = EffectArray.some(
    input.reasons,
    (reason) =>
      reason.code === "roster_full" ||
      (reason.code === "slot_illegal" &&
        !EffectArray.some(roster, (player) => player.key === reason.playerKey)),
  );
  const illegalDetail = illegalDetailOf(input.reasons, occupancy.illegal);
  const placement = planRosterPlacement({ rule: input.rule, players: roster });
  if (placement.kind === "refused") {
    return { fixes: [], detail: illegalDetail ?? noPlaceCure(input.funded) };
  }
  if (!curesIllegalOccupants(input.reasons, roster, placement.placements, input.rule)) {
    return { fixes: [], detail: illegalDetail ?? noPlaceCure(input.funded) };
  }
  const fixes = EffectArray.flatMap(
    orderPlacementMoves(input.rule, roster, placement.moves),
    (move) => {
      const flatMapped1 = fixOf(input.rule, move);
      return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
    },
  );
  if (fixes.length === 0) {
    return { fixes: [], detail: illegalDetail ?? noPlaceCure(input.funded) };
  }
  if (needsPlace && !EffectArray.some(fixes, freesPlace)) {
    return { fixes: [], detail: noPlaceCure(input.funded) };
  }
  return { fixes, detail: undefined };
}

function illegalDetailOf(
  reasons: ReadonlyArray<StoredMoveValidationReason>,
  illegal: ReadonlyArray<{ readonly key: string; readonly detail: string }>,
): string | undefined {
  for (const reason of reasons) {
    if (reason.code !== "slot_illegal") {
      continue;
    }
    const blocker = EffectOption.getOrUndefined(
      EffectArray.findFirst(illegal, (entry) => entry.key === reason.playerKey),
    );
    if (blocker !== undefined) {
      return blocker.detail;
    }
  }
  return illegal[0]?.detail;
}

function curesIllegalOccupants(
  reasons: ReadonlyArray<StoredMoveValidationReason>,
  roster: ReadonlyArray<TransactionPlanRosterPlayer>,
  placements: ReadonlyMap<string, string>,
  rule: RosterRule,
): boolean {
  return EffectArray.every(reasons, (reason) => {
    if (reason.code !== "slot_illegal") {
      return true;
    }
    const occupant = EffectOption.getOrUndefined(
      EffectArray.findFirst(roster, (player) => player.key === reason.playerKey),
    );
    if (occupant === undefined) {
      return true;
    }
    const planned = placements.get(occupant.key);
    return planned !== undefined && slotPlacement(rule, planned, occupant).legal === true;
  });
}

function fixOf(rule: RosterRule, move: RosterPlacementMove): RosterFixDraft {
  const destination = rule.byPosition.get(move.toSlot);
  const origin = rule.byPosition.get(move.fromSlot);
  if (destination?.kind === "reserve" && origin?.kind !== "reserve") {
    return {
      kind: "stash",
      playerKey: move.playerKey,
      playerName: move.playerName,
      detail: `${move.playerName} moves to the ${destination.position} reserve list, which accepts them, to free a place.`,
    };
  }
  if (origin?.kind === "reserve" && destination !== undefined && destination.kind !== "reserve") {
    return {
      kind: "activate",
      playerKey: move.playerKey,
      playerName: move.playerName,
      detail: `${move.playerName} moves back to the active roster at ${destination.position}.`,
    };
  }
  return {
    kind: "slot_move",
    playerKey: move.playerKey,
    playerName: move.playerName,
    toSlot: move.toSlot,
    detail: `${move.playerName} moves to ${move.toSlot}, which accepts their positions.`,
  };
}

function freesPlace(fix: RosterFixDraft): boolean {
  return fix.kind === "stash";
}

function orderPlacementMoves(
  rule: RosterRule,
  roster: ReadonlyArray<TransactionPlanRosterPlayer>,
  moves: ReadonlyArray<RosterPlacementMove>,
): ReadonlyArray<RosterPlacementMove> {
  const occupancy = rosterOccupancy({ rule, players: roster });
  let freeActive = Math.max(0, rule.rosterMaximum - occupancy.occupied);
  const freeReserve = new Map(
    EffectArray.map(occupancy.reserve, (list) => [list.name, list.free] as const),
  );
  const pending = [...moves];
  const ordered: Array<RosterPlacementMove> = [];
  while (pending.length > 0) {
    const index = EffectOption.getOrElse(
      EffectArray.findFirstIndex(pending, (move) => fits(move, freeActive, freeReserve, rule)),
      () => -1,
    );
    if (index < 0) {
      return [...ordered, ...pending];
    }
    const move = pending.splice(index, 1)[0];
    if (move === undefined) {
      return [...ordered, ...pending];
    }
    ordered.push(move);
    const delta = placementDelta(rule, move);
    freeActive += delta.freesActive - delta.usesActive;
    applyReserve(freeReserve, delta.usesReserve, -1);
    applyReserve(freeReserve, delta.freesReserve, 1);
  }
  return ordered;
}

function applyReserve(
  freeReserve: Map<string, number>,
  delta: ReserveDelta | undefined,
  direction: 1 | -1,
): void {
  if (delta === undefined) {
    return;
  }
  freeReserve.set(delta.list, (freeReserve.get(delta.list) ?? 0) + direction * delta.count);
}

function fits(
  move: RosterPlacementMove,
  freeActive: number,
  freeReserve: ReadonlyMap<string, number>,
  rule: RosterRule,
): boolean {
  const delta = placementDelta(rule, move);
  return (
    delta.usesActive <= freeActive &&
    (delta.usesReserve === undefined ||
      (freeReserve.get(delta.usesReserve.list) ?? 0) >= delta.usesReserve.count)
  );
}

function placementDelta(rule: RosterRule, move: RosterPlacementMove): PlacementDelta {
  const fromReserve = rule.byPosition.get(move.fromSlot)?.kind === "reserve";
  const toReserve = rule.byPosition.get(move.toSlot)?.kind === "reserve";
  return {
    usesActive: fromReserve && !toReserve ? 1 : 0,
    freesActive: !fromReserve && toReserve ? 1 : 0,
    usesReserve:
      toReserve && (!fromReserve || move.fromSlot !== move.toSlot)
        ? { list: move.toSlot, count: 1 }
        : undefined,
    freesReserve:
      fromReserve && (!toReserve || move.fromSlot !== move.toSlot)
        ? { list: move.fromSlot, count: 1 }
        : undefined,
  };
}

function noPlaceCure(funded: TransactionPlanMove): string {
  return `${describeTransactionPlanMove(funded)} needs a place, and no injured player on the roster can move to a reserve list to free one. Add a drop, or remove this move.`;
}

export type RosterFixDraft = {
  readonly kind: "activate" | "stash" | "slot_move";
  readonly playerKey: string;
  readonly playerName: string;
  readonly toSlot?: string;
  readonly detail: string;
};

export type RosterFixSearch = {
  readonly fixes: ReadonlyArray<RosterFixDraft>;
  readonly detail: string | undefined;
};

type PlacementDelta = {
  readonly usesActive: number;
  readonly freesActive: number;
  readonly usesReserve: ReserveDelta | undefined;
  readonly freesReserve: ReserveDelta | undefined;
};

type ReserveDelta = {
  readonly list: string;
  readonly count: number;
};
