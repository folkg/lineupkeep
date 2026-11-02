export type LineupProblem = {
  readonly selectionBasis: SelectionBasis;
  readonly availabilityTiers: ReadonlyArray<AvailabilityTier>;
  readonly slots: ReadonlyArray<RosterSlot>;
  readonly players: ReadonlyArray<RosterPlayer>;
};

export type LineupSolveResult =
  | { readonly kind: "plan"; readonly plan: LineupPlan }
  | { readonly kind: "refusal"; readonly refusal: LineupRefusal };

export type LineupPlan = {
  readonly selectionBasis: SelectionBasis;
  readonly assignments: ReadonlyArray<LineupAssignment>;
  readonly leftInPlace: ReadonlyArray<PlayerId>;
  readonly totalSelectionValue: number;
  readonly filledStartingPositions: number;
  readonly requiredStartingPositions: number;
  readonly comparison: LineupComparison;
};

export type LineupRefusal =
  | {
      readonly reason: "unusable-selection-value";
      readonly playerIds: ReadonlyArray<PlayerId>;
    }
  | {
      readonly reason: "lock-references-unknown-slot";
      readonly playerId: PlayerId;
      readonly slotId: SlotId;
    }
  | {
      readonly reason: "locked-player-ineligible-for-slot";
      readonly playerId: PlayerId;
      readonly slotId: SlotId;
    }
  | {
      readonly reason: "lock-capacity-exceeded";
      readonly slotId: SlotId;
      readonly capacity: number;
      readonly playerIds: ReadonlyArray<PlayerId>;
    }
  | {
      readonly reason: "roster-exceeds-slot-capacity";
      readonly playerCount: number;
      readonly slotCapacity: number;
    }
  | {
      readonly reason: "player-has-no-legal-slot";
      readonly playerIds: ReadonlyArray<PlayerId>;
    }
  | {
      readonly reason: "required-starting-position-unfillable";
      readonly slotId: SlotId;
      readonly capacity: number;
      readonly lockedPlayers: number;
      readonly availablePlayerCount: number;
    }
  | {
      readonly reason: "no-legal-assignment";
      readonly playerIds: ReadonlyArray<PlayerId>;
      readonly slotIds: ReadonlyArray<SlotId>;
    };

export type PlanViolation =
  | { readonly reason: "selection-basis-mismatch"; readonly playerIds: ReadonlyArray<PlayerId> }
  | {
      readonly reason: "plan-selection-basis-mismatch";
      readonly problemBasis: SelectionBasis;
      readonly planBasis: SelectionBasis;
    }
  | { readonly reason: "unknown-player"; readonly playerId: PlayerId }
  | { readonly reason: "unknown-slot"; readonly slotId: SlotId }
  | { readonly reason: "player-not-assigned"; readonly playerId: PlayerId }
  | { readonly reason: "player-assigned-more-than-once"; readonly playerId: PlayerId }
  | {
      readonly reason: "slot-capacity-exceeded";
      readonly slotId: SlotId;
      readonly capacity: number;
      readonly assignedPlayers: number;
    }
  | {
      readonly reason: "player-ineligible-for-slot";
      readonly playerId: PlayerId;
      readonly slotId: SlotId;
    }
  | {
      readonly reason: "player-ineligible-for-reserve";
      readonly playerId: PlayerId;
      readonly slotId: SlotId;
    }
  | {
      readonly reason: "lock-violated";
      readonly playerId: PlayerId;
      readonly lockedSlotId: SlotId;
      readonly assignedSlotId: SlotId;
    }
  | {
      readonly reason: "required-starting-position-unfilled";
      readonly slotId: SlotId;
      readonly capacity: number;
      readonly filled: number;
    }
  | { readonly reason: "unusable-selection-value-started"; readonly playerId: PlayerId }
  | { readonly reason: "left-in-place-not-allowed"; readonly playerId: PlayerId }
  | {
      readonly reason: "selection-value-mismatch";
      readonly stated: number;
      readonly recomputed: number;
    }
  | {
      readonly reason: "filled-starting-position-count-mismatch";
      readonly stated: number;
      readonly recomputed: number;
    };

export type LineupComparison = {
  readonly addedStarters: ReadonlyArray<PlayerId>;
  readonly removedStarters: ReadonlyArray<PlayerId>;
  readonly slotChanges: ReadonlyArray<SlotChange>;
};

export type SlotChange = {
  readonly playerId: PlayerId;
  readonly fromSlotId: SlotId | undefined;
  readonly toSlotId: SlotId;
};

export type LineupAssignment = {
  readonly playerId: PlayerId;
  readonly slotId: SlotId;
};

export type RosterSlot = StartingSlot | BenchSlot | ReserveSlot;

export type StartingSlot = {
  readonly kind: "starting";
  readonly id: SlotId;
  readonly capacity: number;
  readonly requirement: StartingPositionRequirement;
  readonly eligibility: SlotEligibility;
};

export type BenchSlot = {
  readonly kind: "bench";
  readonly id: SlotId;
  readonly capacity: number;
  readonly eligibility: SlotEligibility;
};

export type ReserveSlot = {
  readonly kind: "reserve";
  readonly id: SlotId;
  readonly capacity: number;
  readonly eligibility: SlotEligibility;
};

export type StartingPositionRequirement = "required" | "optional";

export type SlotEligibility =
  | { readonly kind: "any" }
  | { readonly kind: "positions"; readonly positions: ReadonlyArray<PositionType> };

export type RosterPlayer = {
  readonly id: PlayerId;
  readonly eligiblePositions: ReadonlyArray<PositionType>;
  readonly availabilityTier: AvailabilityTier;
  readonly selection: PlayerSelection;
  readonly reserveEligible: boolean;
  readonly lockedSlotId: SlotId | undefined;
  readonly currentSlotId: SlotId | undefined;
  readonly mayBeLeftInPlace?: boolean;
};

export type PlayerSelection =
  | {
      readonly kind: "known";
      readonly basis: SelectionBasis;
      readonly units: number;
    }
  | {
      readonly kind: "unusable";
      readonly basis: SelectionBasis;
      readonly reason: UnusableSelectionReason;
    };

export type UnusableSelectionReason = "missing" | "not-comparable";

export type PositionType = string;

declare const slotIdBrand: unique symbol;
export type SlotId = string & { readonly [slotIdBrand]: "SlotId" };

declare const playerIdBrand: unique symbol;
export type PlayerId = string & { readonly [playerIdBrand]: "PlayerId" };

declare const selectionBasisBrand: unique symbol;
export type SelectionBasis = string & { readonly [selectionBasisBrand]: "SelectionBasis" };

declare const availabilityTierBrand: unique symbol;
export type AvailabilityTier = string & {
  readonly [availabilityTierBrand]: "AvailabilityTier";
};

export function makeSlotId(value: string): SlotId {
  if (!isNonEmptySlotId(value)) {
    throw new Error("A slot id must not be empty.");
  }
  return value;
}

export function makePlayerId(value: string): PlayerId {
  if (!isNonEmptyPlayerId(value)) {
    throw new Error("A player id must not be empty.");
  }
  return value;
}

export function makeSelectionBasis(value: string): SelectionBasis {
  if (!isNonEmptySelectionBasis(value)) {
    throw new Error("A selection basis must not be empty.");
  }
  return value;
}

export function makeAvailabilityTier(value: string): AvailabilityTier {
  if (!isNonEmptyAvailabilityTier(value)) {
    throw new Error("An availability tier must not be empty.");
  }
  return value;
}

export function knownSelection(basis: SelectionBasis, units: number): PlayerSelection {
  if (!Number.isSafeInteger(units)) {
    throw new Error("Selection units must be a safe integer.");
  }
  return { kind: "known", basis, units };
}

export function unusableSelection(
  basis: SelectionBasis,
  reason: UnusableSelectionReason,
): PlayerSelection {
  return { kind: "unusable", basis, reason };
}

function isNonEmptySlotId(value: string): value is SlotId {
  return value.length > 0;
}

function isNonEmptyPlayerId(value: string): value is PlayerId {
  return value.length > 0;
}

function isNonEmptySelectionBasis(value: string): value is SelectionBasis {
  return value.length > 0;
}

function isNonEmptyAvailabilityTier(value: string): value is AvailabilityTier {
  return value.length > 0;
}
