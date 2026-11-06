export function slotAcceptsPositions(
  eligibility: ReadonlyArray<string>,
  positions: ReadonlyArray<string>,
): boolean {
  return eligibility.length === 0 || eligibility.some((position) => positions.includes(position));
}

export function ineligibleSlotOccupants(input: {
  readonly slots: ReadonlyArray<SlotEligibilityRule>;
  readonly players: ReadonlyArray<SlotOccupancy>;
}): ReadonlyArray<IneligibleSlotOccupant> {
  const slots = new Map(input.slots.map((slot) => [slot.position, slot] as const));
  return input.players.flatMap((player) => {
    const slot = slots.get(player.slot);
    if (slot === undefined || slotAcceptsPositions(slot.eligibility, player.positions)) {
      return [];
    }
    return [
      {
        key: player.key,
        name: player.name,
        slot: player.slot,
        positions: player.positions,
        detail: slotMismatchDetail(player),
      },
    ];
  });
}

export function slotMismatchDetail(input: {
  readonly name: string;
  readonly slot: string;
  readonly positions: ReadonlyArray<string>;
}): string {
  return `${input.name} is in the ${input.slot} slot, but it does not accept their positions (${input.positions.join(", ")}).`;
}

type SlotEligibilityRule = {
  readonly position: string;
  readonly eligibility: ReadonlyArray<string>;
};

export type SlotOccupancy = {
  readonly key: string;
  readonly name: string;
  readonly slot: string;
  readonly positions: ReadonlyArray<string>;
};

export type IneligibleSlotOccupant = SlotOccupancy & {
  readonly detail: string;
};
