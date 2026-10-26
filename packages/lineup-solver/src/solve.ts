import { munkres } from "munkres";

import {
  compareWithCurrentLineup,
  isStartingSlot,
  planViolations,
  playerMayOccupySlot,
  startingSelectionValue,
} from "./lineup.ts";
import type {
  AvailabilityTier,
  LineupAssignment,
  LineupPlan,
  LineupProblem,
  LineupRefusal,
  LineupSolveResult,
  PlayerId,
  RosterPlayer,
  RosterSlot,
  SlotId,
} from "./types.ts";

export function solveLineup(problem: LineupProblem): LineupSolveResult {
  validateProblem(problem);

  const base = prepareProblem(problem);
  const lockRefusal = findLockRefusal(base);
  if (lockRefusal !== undefined) {
    return { kind: "refusal", refusal: lockRefusal };
  }

  const prepared: PreparedProblem = { ...base, units: buildUnits(base) };

  if (prepared.players.length > prepared.units.length) {
    return {
      kind: "refusal",
      refusal: {
        reason: "roster-exceeds-slot-capacity",
        playerCount: prepared.players.length,
        slotCapacity: prepared.units.length,
      },
    };
  }

  if (prepared.units.length === 0) {
    return { kind: "plan", plan: buildPlan(problem, prepared, []) };
  }

  const unplaceablePlayerIds = prepared.players
    .filter((player) => !hasLegalUnit(prepared, player))
    .map((player) => player.id);
  if (unplaceablePlayerIds.length > 0) {
    return {
      kind: "refusal",
      refusal: { reason: "player-has-no-legal-slot", playerIds: unplaceablePlayerIds },
    };
  }

  const unusableRefusal = findUnusableSelectionRefusal(prepared);
  if (unusableRefusal !== undefined) {
    return { kind: "refusal", refusal: unusableRefusal };
  }

  const requiredRefusal = findRequiredPositionRefusal(prepared);
  if (requiredRefusal !== undefined) {
    return { kind: "refusal", refusal: requiredRefusal };
  }

  const matrix = buildAssignmentMatrix(prepared);
  const pairs = munkres(matrix.costs);
  if (pairs.length !== prepared.units.length) {
    throw new Error("The assignment solver did not return a complete matching.");
  }

  const hasForbiddenEdge = pairs.some(
    ([row, column]) => matrix.costs[row]?.[column] === matrix.forbiddenCost,
  );
  if (hasForbiddenEdge) {
    return { kind: "refusal", refusal: refusalForInfeasible(prepared, matrix, pairs) };
  }

  const assignments = assignmentsFromPairs(matrix, pairs);
  const plan = buildPlan(problem, prepared, assignments);
  const violations = planViolations(problem, plan);
  if (violations.length > 0) {
    throw new Error(`The lineup solver produced an invalid plan: ${JSON.stringify(violations)}`);
  }

  return { kind: "plan", plan };
}

function validateProblem(problem: LineupProblem): void {
  if (problem.selectionBasis.length === 0) {
    throw new Error("A lineup problem requires a non-empty selection basis.");
  }

  if (problem.availabilityTiers.length === 0) {
    throw new Error("A lineup problem requires at least one availability tier.");
  }
  const tiers = new Set<AvailabilityTier>();
  for (const tier of problem.availabilityTiers) {
    if (tiers.has(tier)) {
      throw new Error(`Duplicate availability tier: ${tier}.`);
    }
    tiers.add(tier);
  }

  const slotsById = new Map<SlotId, RosterSlot>();
  for (const slot of problem.slots) {
    if (slot.id.length === 0) {
      throw new Error("A roster slot requires a non-empty id.");
    }
    if (slotsById.has(slot.id)) {
      throw new Error(`Duplicate roster slot id: ${slot.id}.`);
    }
    if (!Number.isSafeInteger(slot.capacity) || slot.capacity <= 0) {
      throw new Error(`Roster slot ${slot.id} requires a positive safe-integer capacity.`);
    }
    slotsById.set(slot.id, slot);
  }

  const playerIds = new Set<PlayerId>();
  for (const player of problem.players) {
    if (player.id.length === 0) {
      throw new Error("A roster player requires a non-empty id.");
    }
    if (playerIds.has(player.id)) {
      throw new Error(`Duplicate roster player id: ${player.id}.`);
    }
    if (player.selection.basis !== problem.selectionBasis) {
      throw new Error(`Player ${player.id} uses a different selection basis.`);
    }
    if (!tiers.has(player.availabilityTier)) {
      throw new Error(`Player ${player.id} uses an undeclared availability tier.`);
    }
    if (player.selection.kind === "known" && !Number.isSafeInteger(player.selection.units)) {
      throw new Error(`Player ${player.id} requires safe-integer selection units.`);
    }
    if (player.currentSlotId !== undefined && !slotsById.has(player.currentSlotId)) {
      throw new Error(`Player ${player.id} references an unknown current slot.`);
    }
    playerIds.add(player.id);
  }
}

function prepareProblem(problem: LineupProblem): ProblemBase {
  const players = [...problem.players].sort((left, right) => compareText(left.id, right.id));
  const slots = [...problem.slots].sort((left, right) => compareText(left.id, right.id));
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]));
  const lockedBySlot = new Map<SlotId, Array<RosterPlayer>>();

  for (const player of players) {
    if (player.lockedSlotId === undefined) {
      continue;
    }
    const locked = lockedBySlot.get(player.lockedSlotId) ?? [];
    locked.push(player);
    lockedBySlot.set(player.lockedSlotId, locked);
  }

  const lockedPlayersBySlot = new Map<SlotId, ReadonlyArray<RosterPlayer>>();
  for (const [slotId, locked] of lockedBySlot) {
    lockedPlayersBySlot.set(
      slotId,
      locked.sort((left, right) => compareText(left.id, right.id)),
    );
  }

  return { problem, players, slots, slotsById, lockedPlayersBySlot };
}
function findLockRefusal(base: ProblemBase): LineupRefusal | undefined {
  for (const player of base.players) {
    if (player.lockedSlotId === undefined) {
      continue;
    }
    const slot = base.slotsById.get(player.lockedSlotId);
    if (slot === undefined) {
      return {
        reason: "lock-references-unknown-slot",
        playerId: player.id,
        slotId: player.lockedSlotId,
      };
    }
    if (!playerMayOccupySlot(player, slot)) {
      return {
        reason: "locked-player-ineligible-for-slot",
        playerId: player.id,
        slotId: slot.id,
      };
    }
  }

  for (const slot of base.slots) {
    const locked = base.lockedPlayersBySlot.get(slot.id) ?? [];
    if (locked.length > slot.capacity) {
      return {
        reason: "lock-capacity-exceeded",
        slotId: slot.id,
        capacity: slot.capacity,
        playerIds: locked.map((player) => player.id),
      };
    }
  }

  return undefined;
}

function buildUnits(base: ProblemBase): ReadonlyArray<SlotUnit> {
  const units: Array<SlotUnit> = [];
  let index = 0;

  for (const slot of base.slots) {
    const locked = base.lockedPlayersBySlot.get(slot.id) ?? [];
    for (let lockedIndex = 0; lockedIndex < locked.length; lockedIndex += 1) {
      units.push({ index, slot, locked: true });
      index += 1;
    }
    const open = slot.capacity - locked.length;
    for (let openIndex = 0; openIndex < open; openIndex += 1) {
      units.push({ index, slot, locked: false });
      index += 1;
    }
  }

  return units;
}

function hasLegalUnit(prepared: PreparedProblem, player: RosterPlayer): boolean {
  return prepared.units.some((unit) => playerAllowedOnUnit(player, unit));
}

function findUnusableSelectionRefusal(prepared: PreparedProblem): LineupRefusal | undefined {
  const playerIds = prepared.players
    .filter((player) => player.selection.kind === "unusable")
    .filter((player) =>
      prepared.units.some((unit) => isStartingSlot(unit.slot) && playerAllowedOnUnit(player, unit)),
    )
    .map((player) => player.id);

  return playerIds.length === 0 ? undefined : { reason: "unusable-selection-value", playerIds };
}

function findRequiredPositionRefusal(prepared: PreparedProblem): LineupRefusal | undefined {
  for (const slot of prepared.slots) {
    if (!isStartingSlot(slot) || slot.requirement !== "required") {
      continue;
    }
    const lockedPlayers = prepared.lockedPlayersBySlot.get(slot.id)?.length ?? 0;
    const openPositions = slot.capacity - lockedPlayers;
    if (openPositions <= 0) {
      continue;
    }
    const availablePlayerCount = prepared.players.filter(
      (player) => player.lockedSlotId === undefined && playerMayOccupySlot(player, slot),
    ).length;
    if (availablePlayerCount < openPositions) {
      return {
        reason: "required-starting-position-unfillable",
        slotId: slot.id,
        capacity: slot.capacity,
        lockedPlayers,
        availablePlayerCount,
      };
    }
  }

  return undefined;
}

function buildAssignmentMatrix(prepared: PreparedProblem): AssignmentMatrix {
  const players = prepared.players;
  const units = prepared.units;
  const playerCount = players.length;
  const unitCount = units.length;
  const scale = costScale(
    playerCount,
    unitCount,
    prepared.problem.availabilityTiers.length,
    maximumAbsoluteValue(players),
    players.map((player) => prepared.problem.availabilityTiers.indexOf(player.availabilityTier)),
  );
  const costs: Array<Array<bigint>> = [];

  for (let row = 0; row < unitCount; row += 1) {
    const player = row < playerCount ? players[row] : undefined;
    const rowCosts: Array<bigint> = [];
    for (const unit of units) {
      rowCosts.push(cellCost(player, row, unit, scale));
    }
    costs.push(rowCosts);
  }

  return { costs, units, players, forbiddenCost: scale.forbiddenCost };
}

function costScale(
  playerCount: number,
  unitCount: number,
  tierCount: number,
  maxAbsValue: number,
  tierRankByPlayerRow: ReadonlyArray<number>,
): CostScale {
  const canonicalBase = BigInt(unitCount + 1);
  const largestCanonicalWeight = playerCount === 0 ? 0n : canonicalBase ** BigInt(playerCount - 1);
  const canonicalMax = BigInt(playerCount * (unitCount - 1)) * largestCanonicalWeight;
  const changeWeight = canonicalMax + 1n;
  const occupancyWeight = BigInt(playerCount) * changeWeight + canonicalMax + 1n;
  const valueWeight =
    BigInt(unitCount) * occupancyWeight + BigInt(playerCount) * changeWeight + canonicalMax + 1n;
  const valueBound = BigInt(unitCount) * BigInt(maxAbsValue) * valueWeight;
  const belowTierBound =
    valueBound +
    BigInt(unitCount) * occupancyWeight +
    BigInt(playerCount) * changeWeight +
    canonicalMax;

  const tierWeights: Array<bigint> = [];
  let lowerBound = belowTierBound;
  for (let rank = tierCount - 1; rank >= 0; rank -= 1) {
    const weight = lowerBound + 1n;
    tierWeights[rank] = weight;
    lowerBound += BigInt(unitCount) * weight;
  }

  const legalCellBound =
    BigInt(maxAbsValue) * valueWeight +
    tierWeights.reduce((total, weight) => total + weight, 0n) +
    occupancyWeight +
    changeWeight +
    canonicalMax;
  const forbiddenCost = legalCellBound * BigInt(2 * unitCount) + 1n;

  return {
    valueWeight,
    occupancyWeight,
    changeWeight,
    forbiddenCost,
    canonicalWeights: Array.from(
      { length: playerCount },
      (_, row) => canonicalBase ** BigInt(playerCount - 1 - row),
    ),
    tierWeightByPlayerRow: tierRankByPlayerRow.map((rank) => tierWeights[rank] ?? 0n),
  };
}

function maximumAbsoluteValue(players: ReadonlyArray<RosterPlayer>): number {
  return players.reduce(
    (maximum, player) =>
      player.selection.kind === "known"
        ? Math.max(maximum, Math.abs(player.selection.units))
        : maximum,
    0,
  );
}

function cellCost(
  player: RosterPlayer | undefined,
  row: number,
  unit: SlotUnit,
  scale: CostScale,
): bigint {
  if (player === undefined) {
    return dummyAllowedOnUnit(unit) ? 0n : scale.forbiddenCost;
  }
  if (!playerAllowedOnUnit(player, unit)) {
    return scale.forbiddenCost;
  }

  const starting = isStartingSlot(unit.slot);
  if (starting && player.selection.kind !== "known") {
    throw new Error("An unusable selection value reached a starting position.");
  }

  const value = starting && player.selection.kind === "known" ? player.selection.units : 0;
  const valueCost = starting ? -BigInt(value) * scale.valueWeight : 0n;
  const availabilityCost = starting && value >= 0 ? -(scale.tierWeightByPlayerRow[row] ?? 0n) : 0n;
  const occupancyCost = starting && value === 0 ? -scale.occupancyWeight : 0n;
  const changeCost = player.currentSlotId === unit.slot.id ? 0n : scale.changeWeight;
  const canonicalWeight = scale.canonicalWeights[row] ?? 0n;
  const canonicalCost = BigInt(unit.index) * canonicalWeight;

  return valueCost + availabilityCost + occupancyCost + changeCost + canonicalCost;
}

function playerAllowedOnUnit(player: RosterPlayer, unit: SlotUnit): boolean {
  if (player.lockedSlotId !== undefined) {
    return (
      unit.locked && unit.slot.id === player.lockedSlotId && playerMayOccupySlot(player, unit.slot)
    );
  }
  return !unit.locked && playerMayOccupySlot(player, unit.slot);
}

function dummyAllowedOnUnit(unit: SlotUnit): boolean {
  if (unit.locked) {
    return false;
  }
  if (isStartingSlot(unit.slot) && unit.slot.requirement === "required") {
    return false;
  }
  return true;
}

function assignmentsFromPairs(
  matrix: AssignmentMatrix,
  pairs: ReadonlyArray<readonly [number, number]>,
): ReadonlyArray<LineupAssignment> {
  const assignments: Array<LineupAssignment> = [];

  for (const [row, column] of pairs) {
    if (row >= matrix.players.length) {
      continue;
    }
    const player = matrix.players[row];
    const unit = matrix.units[column];
    if (player === undefined || unit === undefined) {
      throw new Error("The assignment solver returned an out-of-range pair.");
    }
    assignments.push({ playerId: player.id, slotId: unit.slot.id });
  }

  if (assignments.length !== matrix.players.length) {
    throw new Error("The assignment solver did not assign every roster player.");
  }

  return assignments.sort(compareAssignments);
}

function buildPlan(
  problem: LineupProblem,
  prepared: PreparedProblem,
  assignments: ReadonlyArray<LineupAssignment>,
): LineupPlan {
  const totalSelectionValue = startingSelectionValue(problem, assignments);
  if (totalSelectionValue === undefined) {
    throw new Error("The lineup plan contains a starting player without a usable selection value.");
  }

  const filledStartingPositions = assignments.filter((assignment) => {
    const slot = prepared.slotsById.get(assignment.slotId);
    return slot !== undefined && isStartingSlot(slot);
  }).length;
  const requiredStartingPositions = prepared.slots
    .filter((slot) => isStartingSlot(slot) && slot.requirement === "required")
    .reduce((total, slot) => total + slot.capacity, 0);

  return {
    selectionBasis: problem.selectionBasis,
    assignments,
    totalSelectionValue,
    filledStartingPositions,
    requiredStartingPositions,
    comparison: compareWithCurrentLineup(problem, assignments),
  };
}

function refusalForInfeasible(
  prepared: PreparedProblem,
  matrix: AssignmentMatrix,
  pairs: ReadonlyArray<readonly [number, number]>,
): LineupRefusal {
  const playerIds = new Set<PlayerId>();
  const slotIds = new Set<SlotId>();
  const requiredSlotIds = new Set<SlotId>();

  for (const [row, column] of pairs) {
    if (matrix.costs[row]?.[column] !== matrix.forbiddenCost) {
      continue;
    }
    const unit = matrix.units[column];
    if (unit === undefined) {
      continue;
    }
    slotIds.add(unit.slot.id);
    if (row < matrix.players.length) {
      const player = matrix.players[row];
      if (player !== undefined) {
        playerIds.add(player.id);
      }
    } else if (isStartingSlot(unit.slot) && unit.slot.requirement === "required") {
      requiredSlotIds.add(unit.slot.id);
    }
  }

  const requiredSlotId = [...requiredSlotIds].sort(compareText)[0];
  if (requiredSlotId !== undefined) {
    const slot = prepared.slotsById.get(requiredSlotId);
    if (slot !== undefined && isStartingSlot(slot)) {
      const lockedPlayers = prepared.lockedPlayersBySlot.get(slot.id)?.length ?? 0;
      const availablePlayerCount = prepared.players.filter(
        (player) => player.lockedSlotId === undefined && playerMayOccupySlot(player, slot),
      ).length;
      return {
        reason: "required-starting-position-unfillable",
        slotId: slot.id,
        capacity: slot.capacity,
        lockedPlayers,
        availablePlayerCount,
      };
    }
  }

  return {
    reason: "no-legal-assignment",
    playerIds: [...playerIds].sort(compareText),
    slotIds: [...slotIds].sort(compareText),
  };
}

function compareAssignments(left: LineupAssignment, right: LineupAssignment): number {
  return compareText(left.playerId, right.playerId) || compareText(left.slotId, right.slotId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type SlotUnit = {
  readonly index: number;
  readonly slot: RosterSlot;
  readonly locked: boolean;
};

type ProblemBase = {
  readonly problem: LineupProblem;
  readonly players: ReadonlyArray<RosterPlayer>;
  readonly slots: ReadonlyArray<RosterSlot>;
  readonly slotsById: ReadonlyMap<SlotId, RosterSlot>;
  readonly lockedPlayersBySlot: ReadonlyMap<SlotId, ReadonlyArray<RosterPlayer>>;
};

type PreparedProblem = ProblemBase & {
  readonly units: ReadonlyArray<SlotUnit>;
};

type CostScale = {
  readonly valueWeight: bigint;
  readonly occupancyWeight: bigint;
  readonly changeWeight: bigint;
  readonly forbiddenCost: bigint;
  readonly canonicalWeights: ReadonlyArray<bigint>;
  readonly tierWeightByPlayerRow: ReadonlyArray<bigint>;
};

type AssignmentMatrix = {
  readonly costs: ReadonlyArray<ReadonlyArray<bigint>>;
  readonly units: ReadonlyArray<SlotUnit>;
  readonly players: ReadonlyArray<RosterPlayer>;
  readonly forbiddenCost: bigint;
};
