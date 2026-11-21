import { Array as EffectArray } from "effect";

import type { ProviderReserveEligibility, ProviderRosterConstraints } from "./Provider.ts";
import type { ReserveEligibility, ReserveList, RosterPlaces } from "./QueryValues.ts";

export type RosterSlot = {
  readonly position: string;
  readonly kind: "starting" | "bench" | "reserve";
  readonly count: number;
  readonly eligibility: ReadonlyArray<string>;
};

export type RosterRule = ProviderRosterConstraints & {
  readonly slots: ReadonlyArray<RosterSlot>;
  readonly byPosition: ReadonlyMap<string, RosterSlot>;
};

export function rosterRuleOf(
  constraints: ProviderRosterConstraints,
  slots: ReadonlyArray<RosterSlot>,
): RosterRule {
  return {
    ...constraints,
    slots,
    byPosition: new Map(EffectArray.map(slots, (slot) => [slot.position, slot] as const)),
  };
}

export type SlotPlacement =
  | { readonly kind: "starting"; readonly countsAsPlace: true; readonly legal: boolean }
  | { readonly kind: "bench"; readonly countsAsPlace: true; readonly legal: true }
  | {
      readonly kind: "reserve";
      readonly countsAsPlace: false;
      readonly legal: boolean | "unknown";
    }
  | { readonly kind: "unverified"; readonly countsAsPlace: true; readonly legal: true };

export function slotPlacement(
  rule: RosterRule,
  slot: string | undefined,
  player: RosterPlaceFacts,
): SlotPlacement {
  const declared = slot === undefined ? undefined : rule.byPosition.get(slot);
  if (declared === undefined) {
    return { kind: "unverified", countsAsPlace: true, legal: true };
  }
  switch (declared.kind) {
    case "starting":
      return {
        kind: "starting",
        countsAsPlace: true,
        legal: acceptsPositions(declared.eligibility, player.positions),
      };
    case "bench":
      return { kind: "bench", countsAsPlace: true, legal: true };
    case "reserve":
      return {
        kind: "reserve",
        countsAsPlace: false,
        legal: reserveLegality(rule, declared, player),
      };
  }
}

function reserveLegality(
  rule: RosterRule,
  slot: RosterSlot,
  player: RosterPlaceFacts,
): boolean | "unknown" {
  switch (rule.reserveEligibility.kind) {
    case "published_positions":
      return acceptsPositions(slot.eligibility, player.positions);
    case "injury_status": {
      if (!player.injured) {
        return false;
      }
      const named = EffectArray.filter(
        rule.slots,
        (held) => held.kind === "reserve" && player.positions.includes(held.position),
      );
      return (
        named.length === 0 || EffectArray.some(named, (held) => held.position === slot.position)
      );
    }
    case "not_published":
      return "unknown";
  }
}

function acceptsPositions(
  eligibility: ReadonlyArray<string>,
  positions: ReadonlyArray<string>,
): boolean {
  return (
    eligibility.length === 0 ||
    EffectArray.some(eligibility, (position) => positions.includes(position))
  );
}

export function slotCapacity(rule: RosterRule, slot: RosterSlot): number | undefined {
  return slot.kind === "bench" && rule.benchCapacity === "generic" ? undefined : slot.count;
}

export function exclusivePlace(rule: RosterRule, place: string): boolean {
  const declared = rule.byPosition.get(place);
  return declared === undefined ? true : slotCapacity(rule, declared) === 1;
}

export function rosterOccupancy(input: {
  readonly rule: RosterRule;
  readonly players: ReadonlyArray<RosterPlayerPlace>;
}): RosterOccupancy {
  const occupancy = new Map<string, number>();
  const mismatched: Array<
    RosterPlayerPlace & { readonly slot: string; readonly kind: "starting" | "bench" | "reserve" }
  > = [];
  let occupied = 0;
  let reserved = 0;
  for (const player of input.players) {
    const placement = slotPlacement(input.rule, player.slot, player);
    if (placement.countsAsPlace) {
      occupied += 1;
    } else {
      reserved += 1;
    }
    const declared = player.slot === undefined ? undefined : input.rule.byPosition.get(player.slot);
    if (declared === undefined) {
      continue;
    }
    occupancy.set(declared.position, (occupancy.get(declared.position) ?? 0) + 1);
    if (placement.legal === false) {
      mismatched.push({
        ...player,
        slot: declared.position,
        kind: declared.kind,
      });
    }
  }
  const illegal = EffectArray.map(mismatched, (player) => {
    const blocker = rosterBlocker({
      name: player.name,
      slot: player.slot,
      kind: player.kind,
      positions: player.positions,
      reserveEligibility: input.rule.reserveEligibility,
      occupied,
      maximum: input.rule.rosterMaximum,
    });
    return { ...player, ...blocker, detail: illegalRosterDetail(blocker) };
  });
  const overflow: Array<RosterSlotShortfall> = [];
  for (const slot of input.rule.slots) {
    const occupants = occupancy.get(slot.position) ?? 0;
    const capacity = slotCapacity(input.rule, slot);
    if (capacity !== undefined && occupants > capacity) {
      overflow.push({ slot, occupants });
    }
  }
  return {
    maximum: input.rule.rosterMaximum,
    occupied,
    reserved,
    places: {
      used: occupied,
      maximum: input.rule.rosterMaximum,
      free: Math.max(0, input.rule.rosterMaximum - occupied),
    },
    reserve: EffectArray.map(
      EffectArray.filter(input.rule.slots, (slot) => slot.kind === "reserve"),
      (slot): ReserveList => {
        const occupants = occupancy.get(slot.position) ?? 0;
        return {
          name: slot.position,
          eligibility: reserveEligibilityFacts(input.rule, slot),
          capacity: slot.count,
          occupied: occupants,
          free: Math.max(0, slot.count - occupants),
        };
      },
    ),
    illegal,
    overflow,
  };
}

function reserveEligibilityFacts(rule: RosterRule, slot: RosterSlot): ReserveEligibility {
  switch (rule.reserveEligibility.kind) {
    case "published_positions":
      return { kind: "published_positions", positions: slot.eligibility };
    case "injury_status":
      return { kind: "injury_status" };
    case "not_published":
      return { kind: "not_published", detail: rule.reserveEligibility.detail };
  }
}

export function slotMismatchDetail(input: {
  readonly name: string;
  readonly slot: string;
  readonly kind: "starting" | "bench" | "reserve";
  readonly positions: ReadonlyArray<string>;
  readonly reserveEligibility: ProviderReserveEligibility;
  readonly injured: boolean;
  readonly mismatch: SlotMismatch;
}): string {
  if (input.mismatch.kind === "occupied") {
    return illegalRosterDetail(
      rosterBlocker({
        name: input.name,
        slot: input.slot,
        kind: input.kind,
        positions: input.positions,
        reserveEligibility: input.reserveEligibility,
        occupied: input.mismatch.occupied,
        maximum: input.mismatch.maximum,
      }),
    );
  }
  if (input.kind === "reserve" && input.reserveEligibility.kind === "injury_status") {
    return `${input.name} is not injured, so they cannot move to ${input.slot}: it only accepts an injured player.`;
  }
  return `${input.name} cannot move to ${input.slot}: it does not accept their positions (${EffectArray.join(input.positions, ", ")}).`;
}

function rosterBlocker(input: {
  readonly name: string;
  readonly slot: string;
  readonly kind: "starting" | "bench" | "reserve";
  readonly positions: ReadonlyArray<string>;
  readonly reserveEligibility: ProviderReserveEligibility;
  readonly occupied: number;
  readonly maximum: number;
}): RosterBlockerFacts {
  if (input.kind === "reserve" && input.reserveEligibility.kind === "injury_status") {
    return {
      fact: `${input.name} is no longer injured but sits in ${input.slot}.`,
      cure: reserveCure(input.name, input.occupied, input.maximum),
    };
  }
  return {
    fact: `${input.name} sits in ${input.slot}, but ${input.slot} does not accept their positions (${EffectArray.join(input.positions, ", ")}).`,
    cure:
      input.kind === "reserve"
        ? reserveCure(input.name, input.occupied, input.maximum)
        : `Move ${input.name} to a place that accepts their positions, or drop ${input.name}.`,
  };
}

function illegalRosterDetail(input: RosterBlockerFacts): string {
  return `${input.fact} This roster is illegal, so all adds and drops are blocked until it is cured. ${input.cure}`;
}

function reserveCure(name: string, occupied: number, maximum: number): string {
  if (maximum === 0) {
    return `Drop ${name}.`;
  }
  return occupied >= maximum
    ? `Activate ${name} together with a drop, or drop ${name}.`
    : `Activate ${name}, or drop ${name}.`;
}

export function rosterPlayerInjured(player: {
  readonly injuryCode: string | undefined;
  readonly injuryDetail: string | undefined;
}): boolean {
  return player.injuryCode !== undefined || player.injuryDetail !== undefined;
}

export type RosterPlaceFacts = {
  readonly positions: ReadonlyArray<string>;
  readonly injured: boolean;
};

export type RosterPlayerPlace = RosterPlaceFacts & {
  readonly key: string;
  readonly name: string;
  readonly slot: string | undefined;
};

type SlotMismatch =
  | { readonly kind: "occupied"; readonly occupied: number; readonly maximum: number }
  | { readonly kind: "destination" };

export type RosterOccupancy = {
  readonly maximum: number;
  readonly occupied: number;
  readonly reserved: number;
  readonly places: RosterPlaces;
  readonly reserve: ReadonlyArray<ReserveList>;
  readonly illegal: ReadonlyArray<IneligibleSlotOccupant>;
  readonly overflow: ReadonlyArray<RosterSlotShortfall>;
};

type IneligibleSlotOccupant = RosterPlayerPlace &
  RosterBlockerFacts & {
    readonly slot: string;
    readonly kind: "starting" | "bench" | "reserve";
    readonly detail: string;
  };

type RosterBlockerFacts = {
  readonly fact: string;
  readonly cure: string;
};

type RosterSlotShortfall = {
  readonly slot: RosterSlot;
  readonly occupants: number;
};
