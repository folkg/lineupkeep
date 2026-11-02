import type {
  LineupAssignment,
  LineupComparison,
  LineupPlan,
  LineupProblem,
  PlanViolation,
  PlayerId,
  RosterPlayer,
  RosterSlot,
  SlotChange,
  SlotEligibility,
  StartingSlot,
} from "./types.ts";

export function isStartingSlot(slot: RosterSlot): slot is StartingSlot {
  return slot.kind === "starting";
}

export function playerMayOccupySlot(player: RosterPlayer, slot: RosterSlot): boolean {
  if (player.lockedSlotId !== undefined && player.lockedSlotId !== slot.id) {
    return false;
  }
  if (slot.kind === "reserve" && !player.reserveEligible) {
    return false;
  }
  return eligibilityAcceptsPositions(slot.eligibility, player.eligiblePositions);
}

export function compareWithCurrentLineup(
  problem: LineupProblem,
  assignments: ReadonlyArray<LineupAssignment>,
  leftInPlace: ReadonlyArray<PlayerId> = [],
): LineupComparison {
  const slotsById = new Map(problem.slots.map((slot) => [slot.id, slot]));
  const assignedSlotByPlayer = new Map(
    assignments.map((assignment) => [assignment.playerId, assignment.slotId]),
  );
  const left = new Set(leftInPlace);
  const addedStarters: Array<PlayerId> = [];
  const removedStarters: Array<PlayerId> = [];
  const slotChanges: Array<SlotChange> = [];

  for (const player of sortedPlayers(problem.players)) {
    if (left.has(player.id)) {
      continue;
    }
    const currentSlotId = player.currentSlotId;
    const nextSlotId = assignedSlotByPlayer.get(player.id);
    const currentIsStarting =
      currentSlotId !== undefined && slotsById.get(currentSlotId)?.kind === "starting";
    const nextIsStarting =
      nextSlotId !== undefined && slotsById.get(nextSlotId)?.kind === "starting";

    if (nextIsStarting && !currentIsStarting) {
      addedStarters.push(player.id);
    }
    if (currentIsStarting && !nextIsStarting) {
      removedStarters.push(player.id);
    }
    if (nextSlotId !== undefined && currentSlotId !== nextSlotId) {
      slotChanges.push({ playerId: player.id, fromSlotId: currentSlotId, toSlotId: nextSlotId });
    }
  }

  return { addedStarters, removedStarters, slotChanges };
}

export function startingSelectionValue(
  problem: LineupProblem,
  assignments: ReadonlyArray<LineupAssignment>,
): number | undefined {
  const playersById = new Map(problem.players.map((player) => [player.id, player]));
  const slotsById = new Map(problem.slots.map((slot) => [slot.id, slot]));
  let total = 0;

  for (const assignment of assignments) {
    const slot = slotsById.get(assignment.slotId);
    const player = playersById.get(assignment.playerId);
    if (slot === undefined || player === undefined) {
      return undefined;
    }
    if (!isStartingSlot(slot)) {
      continue;
    }
    if (player.selection.kind !== "known") {
      return undefined;
    }
    total += player.selection.units;
  }

  return total;
}

export function lineupViolations(
  problem: LineupProblem,
  assignments: ReadonlyArray<LineupAssignment>,
): ReadonlyArray<PlanViolation> {
  const checked = assignmentViolations(problem, assignments, new Map());
  const violations = [...checked.violations];

  for (const player of sortedPlayers(problem.players)) {
    const count = checked.assignmentsByPlayer.get(player.id) ?? 0;
    if (count === 0) {
      violations.push({ reason: "player-not-assigned", playerId: player.id });
    }
    if (count > 1) {
      violations.push({ reason: "player-assigned-more-than-once", playerId: player.id });
    }
  }

  return violations;
}

export function isLegalLineup(
  problem: LineupProblem,
  assignments: ReadonlyArray<LineupAssignment>,
): boolean {
  return lineupViolations(problem, assignments).length === 0;
}

export function planViolations(
  problem: LineupProblem,
  plan: LineupPlan,
): ReadonlyArray<PlanViolation> {
  const playersById = new Map(problem.players.map((player) => [player.id, player]));
  const leftInPlace = new Map<PlayerId, number>();
  const occupiedElsewhere = new Map<string, number>();
  const violations: Array<PlanViolation> = [];

  for (const playerId of plan.leftInPlace) {
    leftInPlace.set(playerId, (leftInPlace.get(playerId) ?? 0) + 1);
  }
  for (const [playerId, count] of leftInPlace) {
    const player = playersById.get(playerId);
    if (player === undefined) {
      violations.push({ reason: "unknown-player", playerId });
      continue;
    }
    if (player.mayBeLeftInPlace !== true) {
      violations.push({ reason: "left-in-place-not-allowed", playerId });
    }
    if (player.currentSlotId !== undefined) {
      occupiedElsewhere.set(
        player.currentSlotId,
        (occupiedElsewhere.get(player.currentSlotId) ?? 0) + count,
      );
    }
  }

  const checked = assignmentViolations(problem, plan.assignments, occupiedElsewhere);
  for (const violation of checked.violations) {
    violations.push(violation);
  }

  for (const player of sortedPlayers(problem.players)) {
    const assigned = checked.assignmentsByPlayer.get(player.id) ?? 0;
    const left = leftInPlace.get(player.id) ?? 0;
    if (assigned + left === 0) {
      violations.push({ reason: "player-not-assigned", playerId: player.id });
    }
    if (assigned + left > 1) {
      violations.push({ reason: "player-assigned-more-than-once", playerId: player.id });
    }
  }

  const recomputedValue = startingSelectionValue(problem, plan.assignments);

  if (plan.selectionBasis !== problem.selectionBasis) {
    violations.push({
      reason: "plan-selection-basis-mismatch",
      problemBasis: problem.selectionBasis,
      planBasis: plan.selectionBasis,
    });
  }

  if (recomputedValue !== undefined && recomputedValue !== plan.totalSelectionValue) {
    violations.push({
      reason: "selection-value-mismatch",
      stated: plan.totalSelectionValue,
      recomputed: recomputedValue,
    });
  }

  const slotsById = new Map(problem.slots.map((slot) => [slot.id, slot]));
  const filledStartingPositions = plan.assignments.filter(
    (assignment) => slotsById.get(assignment.slotId)?.kind === "starting",
  ).length;

  if (filledStartingPositions !== plan.filledStartingPositions) {
    violations.push({
      reason: "filled-starting-position-count-mismatch",
      stated: plan.filledStartingPositions,
      recomputed: filledStartingPositions,
    });
  }

  return violations;
}

function assignmentViolations(
  problem: LineupProblem,
  assignments: ReadonlyArray<LineupAssignment>,
  occupiedElsewhere: ReadonlyMap<string, number>,
): {
  readonly violations: ReadonlyArray<PlanViolation>;
  readonly assignmentsByPlayer: ReadonlyMap<PlayerId, number>;
} {
  const playersById = new Map(problem.players.map((player) => [player.id, player]));
  const slotsById = new Map(problem.slots.map((slot) => [slot.id, slot]));
  const orderedAssignments = [...assignments].sort(compareAssignments);
  const assignmentsByPlayer = new Map<PlayerId, number>();
  const assignmentsBySlot = new Map<string, number>();
  const violations: Array<PlanViolation> = [];

  const mismatchedBasisPlayerIds = sortedPlayers(problem.players)
    .filter((player) => player.selection.basis !== problem.selectionBasis)
    .map((player) => player.id);
  if (mismatchedBasisPlayerIds.length > 0) {
    violations.push({
      reason: "selection-basis-mismatch",
      playerIds: mismatchedBasisPlayerIds,
    });
  }

  for (const assignment of orderedAssignments) {
    const player = playersById.get(assignment.playerId);
    const slot = slotsById.get(assignment.slotId);

    assignmentsByPlayer.set(
      assignment.playerId,
      (assignmentsByPlayer.get(assignment.playerId) ?? 0) + 1,
    );
    assignmentsBySlot.set(assignment.slotId, (assignmentsBySlot.get(assignment.slotId) ?? 0) + 1);

    if (player === undefined) {
      violations.push({ reason: "unknown-player", playerId: assignment.playerId });
    }
    if (slot === undefined) {
      violations.push({ reason: "unknown-slot", slotId: assignment.slotId });
    }
    if (player === undefined || slot === undefined) {
      continue;
    }

    if (!eligibilityAcceptsPositions(slot.eligibility, player.eligiblePositions)) {
      violations.push({
        reason: "player-ineligible-for-slot",
        playerId: player.id,
        slotId: slot.id,
      });
    }
    if (slot.kind === "reserve" && !player.reserveEligible) {
      violations.push({
        reason: "player-ineligible-for-reserve",
        playerId: player.id,
        slotId: slot.id,
      });
    }
    if (player.lockedSlotId !== undefined && player.lockedSlotId !== slot.id) {
      violations.push({
        reason: "lock-violated",
        playerId: player.id,
        lockedSlotId: player.lockedSlotId,
        assignedSlotId: slot.id,
      });
    }
    if (isStartingSlot(slot) && player.selection.kind !== "known") {
      violations.push({ reason: "unusable-selection-value-started", playerId: player.id });
    }
  }

  for (const slot of sortedSlots(problem.slots)) {
    const assigned = assignmentsBySlot.get(slot.id) ?? 0;
    const occupied = assigned + (occupiedElsewhere.get(slot.id) ?? 0);
    if (occupied > slot.capacity) {
      violations.push({
        reason: "slot-capacity-exceeded",
        slotId: slot.id,
        capacity: slot.capacity,
        assignedPlayers: occupied,
      });
    }
    if (slot.kind === "starting" && slot.requirement === "required" && assigned < slot.capacity) {
      violations.push({
        reason: "required-starting-position-unfilled",
        slotId: slot.id,
        capacity: slot.capacity,
        filled: assigned,
      });
    }
  }

  return { violations, assignmentsByPlayer };
}

export function isLegalPlan(problem: LineupProblem, plan: LineupPlan): boolean {
  return planViolations(problem, plan).length === 0;
}

function eligibilityAcceptsPositions(
  eligibility: SlotEligibility,
  positions: ReadonlyArray<string>,
): boolean {
  if (eligibility.kind === "any") {
    return true;
  }
  return positions.some((position) => eligibility.positions.includes(position));
}

function compareAssignments(left: LineupAssignment, right: LineupAssignment): number {
  return compareText(left.playerId, right.playerId) || compareText(left.slotId, right.slotId);
}

function sortedPlayers(players: ReadonlyArray<RosterPlayer>): ReadonlyArray<RosterPlayer> {
  return [...players].sort((left, right) => compareText(left.id, right.id));
}

function sortedSlots(slots: ReadonlyArray<RosterSlot>): ReadonlyArray<RosterSlot> {
  return [...slots].sort((left, right) => compareText(left.id, right.id));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
