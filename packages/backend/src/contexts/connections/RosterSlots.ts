import type { ProviderRosterConstraints } from "./Provider.ts";

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
    byPosition: new Map(slots.map((slot) => [slot.position, slot] as const)),
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
  positions: ReadonlyArray<string>,
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
        legal: acceptsPositions(declared.eligibility, positions),
      };
    case "bench":
      return { kind: "bench", countsAsPlace: true, legal: true };
    case "reserve":
      return {
        kind: "reserve",
        countsAsPlace: false,
        legal:
          rule.reserveEligibility.kind === "published_positions"
            ? acceptsPositions(declared.eligibility, positions)
            : "unknown",
      };
  }
}

function acceptsPositions(
  eligibility: ReadonlyArray<string>,
  positions: ReadonlyArray<string>,
): boolean {
  return eligibility.length === 0 || eligibility.some((position) => positions.includes(position));
}

export function slotCapacity(rule: RosterRule, slot: RosterSlot): number | undefined {
  return slot.kind === "bench" && rule.benchCapacity === "generic" ? undefined : slot.count;
}

export function rosterPlaceCount(rule: RosterRule, slot: string | undefined): number {
  return slot !== undefined && rule.byPosition.get(slot)?.kind === "reserve" ? 0 : 1;
}

export function rosterPlaceChange(
  rule: RosterRule,
  fromSlot: string | undefined,
  toSlot: string | undefined,
): { readonly frees: number; readonly consumes: number } {
  const before = rosterPlaceCount(rule, fromSlot);
  const after = toSlot === undefined ? 0 : rosterPlaceCount(rule, toSlot);
  return after < before
    ? { frees: before - after, consumes: 0 }
    : { frees: 0, consumes: after - before };
}

export function rosterOccupancy(input: {
  readonly rule: RosterRule;
  readonly players: ReadonlyArray<RosterPlayerPlace>;
}): RosterOccupancy {
  const occupancy = new Map<string, number>();
  const illegal: Array<IneligibleSlotOccupant> = [];
  let occupied = 0;
  let reserved = 0;
  for (const player of input.players) {
    const placement = slotPlacement(input.rule, player.slot, player.positions);
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
      illegal.push({
        key: player.key,
        name: player.name,
        slot: declared.position,
        kind: declared.kind,
        positions: player.positions,
        detail: slotMismatchDetail({
          name: player.name,
          slot: declared.position,
          kind: declared.kind,
          positions: player.positions,
        }),
      });
    }
  }
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
    illegal,
    overflow,
  };
}

export function slotMismatchDetail(input: {
  readonly name: string;
  readonly slot: string;
  readonly kind: "starting" | "bench" | "reserve";
  readonly positions: ReadonlyArray<string>;
}): string {
  const where =
    input.kind === "reserve"
      ? `on the ${input.slot} reserve list`
      : `in the ${input.slot} starting slot`;
  return `${input.name} is ${where}, but it does not accept their positions (${input.positions.join(", ")}).`;
}

export type RosterPlayerPlace = {
  readonly key: string;
  readonly name: string;
  readonly slot: string | undefined;
  readonly positions: ReadonlyArray<string>;
};

export type RosterOccupancy = {
  readonly maximum: number;
  readonly occupied: number;
  readonly reserved: number;
  readonly illegal: ReadonlyArray<IneligibleSlotOccupant>;
  readonly overflow: ReadonlyArray<RosterSlotShortfall>;
};

type IneligibleSlotOccupant = RosterPlayerPlace & {
  readonly slot: string;
  readonly kind: "starting" | "bench" | "reserve";
  readonly detail: string;
};

type RosterSlotShortfall = {
  readonly slot: RosterSlot;
  readonly occupants: number;
};
