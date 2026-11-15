import { rosterOccupancy, slotCapacity, slotPlacement } from "#contexts/connections/RosterSlots.ts";
import type { RosterRule } from "#contexts/connections/RosterSlots.ts";

import { describeTransactionPlanMove } from "./TransactionPlanEvaluation.ts";
import type {
  TransactionPlanMove,
  TransactionPlanRosterPlayer,
  TransactionPlanTeamFacts,
} from "./TransactionPlanEvaluation.ts";
import type { StoredMoveValidationReason, TransactionMoveId } from "./TransactionPlanRecord.ts";

const rosterFixGroupPrefix = "roster-fixes:";

export const rosterFixLabel = "Roster fixes";

export function rosterFixGroupOf(move: TransactionMoveId): string {
  return `${rosterFixGroupPrefix}${move}`;
}

export function isRosterFixGroup(group: string | undefined): boolean {
  return group !== undefined && group.startsWith(rosterFixGroupPrefix);
}

export function searchRosterFixes(input: {
  readonly facts: TransactionPlanTeamFacts;
  readonly rule: RosterRule;
  readonly funded: TransactionPlanMove;
  readonly reasons: ReadonlyArray<StoredMoveValidationReason>;
}): RosterFixSearch {
  if (
    !input.reasons.some((reason) => reason.code === "roster_full" || reason.code === "slot_illegal")
  ) {
    return { fixes: [], detail: undefined };
  }
  const roster = input.facts.roster.filter(
    (player) => !input.funded.drops.some((drop) => drop.key === player.key),
  );
  const occupancy = rosterOccupancy({ rule: input.rule, players: roster });
  const illegal = new Map(occupancy.illegal.map((entry) => [entry.key, entry.detail] as const));
  const legalizing: Array<RosterFixDraft> = [];
  let free = occupancy.places.free;
  let needsPlace = false;

  for (const reason of input.reasons) {
    if (reason.code === "roster_full") {
      needsPlace = true;
      continue;
    }
    if (reason.code !== "slot_illegal") {
      continue;
    }
    const occupant = roster.find((player) => player.key === reason.playerKey);
    if (occupant === undefined) {
      needsPlace = true;
      continue;
    }
    const fix = legalizingFix({ rule: input.rule, roster, occupant });
    if (fix === undefined) {
      return { fixes: [], detail: illegal.get(occupant.key) };
    }
    free -= placesUsedBy(fix);
    if (!legalizing.some((held) => held.kind === fix.kind && held.playerKey === fix.playerKey)) {
      legalizing.push(fix);
    }
  }

  const needed = needsPlace ? 1 : 0;
  const fixes = [...legalizing];
  if (free < needed) {
    const freeing = freeingFix({ rule: input.rule, roster });
    if (freeing === undefined) {
      return { fixes: [], detail: noPlaceCure(input.funded) };
    }
    fixes.unshift(freeing);
    free += 1;
  }
  if (fixes.length === 0 || free < needed) {
    return { fixes: [], detail: noPlaceCure(input.funded) };
  }
  return { fixes, detail: undefined };
}

function legalizingFix(input: {
  readonly rule: RosterRule;
  readonly roster: ReadonlyArray<TransactionPlanRosterPlayer>;
  readonly occupant: TransactionPlanRosterPlayer;
}): RosterFixDraft | undefined {
  const declared =
    input.occupant.slot === undefined ? undefined : input.rule.byPosition.get(input.occupant.slot);
  if (declared === undefined) {
    return undefined;
  }
  if (declared.kind === "reserve") {
    return {
      kind: "activate",
      playerKey: input.occupant.key,
      playerName: input.occupant.name,
      detail: `${input.occupant.name} moves back to the active roster, because ${declared.position} no longer accepts them.`,
    };
  }
  const destination = openActivePlace(input);
  return destination === undefined
    ? undefined
    : {
        kind: "slot_move",
        playerKey: input.occupant.key,
        playerName: input.occupant.name,
        toSlot: destination,
        detail: `${input.occupant.name} moves to ${destination}, which accepts their positions.`,
      };
}

function openActivePlace(input: {
  readonly rule: RosterRule;
  readonly roster: ReadonlyArray<TransactionPlanRosterPlayer>;
  readonly occupant: TransactionPlanRosterPlayer;
}): string | undefined {
  const ordered = [
    ...input.rule.slots.filter((slot) => slot.kind === "bench"),
    ...input.rule.slots.filter((slot) => slot.kind === "starting"),
  ];
  for (const slot of ordered) {
    const capacity = slotCapacity(input.rule, slot);
    const occupants = input.roster.filter((player) => player.slot === slot.position).length;
    if (capacity !== undefined && occupants >= capacity) {
      continue;
    }
    if (slotPlacement(input.rule, slot.position, input.occupant).legal === true) {
      return slot.position;
    }
  }
  return undefined;
}

function freeingFix(input: {
  readonly rule: RosterRule;
  readonly roster: ReadonlyArray<TransactionPlanRosterPlayer>;
}): RosterFixDraft | undefined {
  for (const player of input.roster) {
    const slot = player.slot === undefined ? undefined : input.rule.byPosition.get(player.slot);
    if (slot === undefined || slot.kind === "reserve" || !player.injured) {
      continue;
    }
    const list = input.rule.slots.find(
      (held) =>
        held.kind === "reserve" &&
        slotPlacement(input.rule, held.position, player).legal === true &&
        input.roster.filter((occupant) => occupant.slot === held.position).length < held.count,
    );
    if (list === undefined) {
      continue;
    }
    return {
      kind: "stash",
      playerKey: player.key,
      playerName: player.name,
      detail: `${player.name} moves to the ${list.position} reserve list, which accepts them, to free a place.`,
    };
  }
  return undefined;
}

function placesUsedBy(fix: RosterFixDraft): number {
  return fix.kind === "activate" ? 1 : 0;
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
