import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isLegalPlan } from "./lineup.ts";
import { solveLineup } from "./solve.ts";
import {
  knownSelection,
  makeAvailabilityTier,
  makePlayerId,
  makeSelectionBasis,
  makeSlotId,
} from "./types.ts";
import type {
  AvailabilityTier,
  LineupAssignment,
  LineupPlan,
  LineupProblem,
  PlayerId,
  RosterPlayer,
  RosterSlot,
  SlotId,
} from "./types.ts";

const basis = makeSelectionBasis("oracle-basis");
const willPlay = makeAvailabilityTier("will-play");
const mightPlay = makeAvailabilityTier("might-play");
const willNotPlay = makeAvailabilityTier("will-not-play");
const tiers = [willPlay, mightPlay, willNotPlay];

describe("exhaustive oracle agreement", () => {
  it.each(adversarialCases())("agrees on $name", ({ problem }) => {
    expectAgreement(problem);
  });

  it("agrees with the exhaustive oracle on generated tiny problems", () => {
    let generatedProblems = 0;

    fc.assert(
      fc.property(generatedProblemArbitrary(), (problem) => {
        generatedProblems += 1;
        expectAgreement(problem);
      }),
      { numRuns: 10000, seed: 20261026 },
    );

    expect(generatedProblems).toBe(10000);
  });

  it("never worsens the achieved objective when a player's value increases", () => {
    fc.assert(
      fc.property(generatedProblemArbitrary(), fc.nat(), (problem, offset) => {
        if (problem.players.length === 0) {
          return;
        }
        const index = offset % problem.players.length;
        const target = problem.players[index];
        if (target === undefined || target.selection.kind !== "known") {
          return;
        }

        const increased: LineupProblem = {
          ...problem,
          players: problem.players.map((player, playerIndex) =>
            playerIndex === index && player.selection.kind === "known"
              ? { ...player, selection: knownSelection(basis, player.selection.units + 1) }
              : player,
          ),
        };
        const before = solveLineup(problem);
        const after = solveLineup(increased);

        expect(after.kind).toBe(before.kind);
        if (before.kind === "plan" && after.kind === "plan") {
          expect(
            compareObjectives(
              objectiveOf(increased, after.plan),
              objectiveOf(problem, before.plan),
            ),
          ).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 2000, seed: 20261027 },
    );
  });

  it("finds a known optimum and a known infeasibility", () => {
    const optimal = lineupProblem(
      [startingSlot("S1", 1, "optional", ["A"]), startingSlot("S2", 1, "optional", ["A"])],
      [player("a", 1, { positions: ["A"] }), player("b", 2, { positions: ["A"] })],
    );
    const infeasible = lineupProblem(
      [startingSlot("S1", 1, "required", ["A"])],
      [player("a", 1, { positions: ["B"] })],
    );

    expect(solveTinyProblem(optimal)).toMatchObject({ kind: "optimal", value: 3 });
    expect(solveTinyProblem(infeasible)).toEqual({ kind: "infeasible" });
  });
});

function oracleLineupViolations(
  problem: LineupProblem,
  assignments: ReadonlyArray<LineupAssignment>,
): ReadonlyArray<string> {
  const playersById = new Map(problem.players.map((player) => [player.id, player]));
  const slotsById = new Map(problem.slots.map((slot) => [slot.id, slot]));
  const assignmentsByPlayer = new Map<PlayerId, number>();
  const assignmentsBySlot = new Map<SlotId, number>();
  const violations: Array<string> = [];

  for (const assignment of assignments) {
    const player = playersById.get(assignment.playerId);
    const slot = slotsById.get(assignment.slotId);
    assignmentsByPlayer.set(
      assignment.playerId,
      (assignmentsByPlayer.get(assignment.playerId) ?? 0) + 1,
    );
    assignmentsBySlot.set(assignment.slotId, (assignmentsBySlot.get(assignment.slotId) ?? 0) + 1);
    if (player === undefined) {
      violations.push(`unknown player ${assignment.playerId}`);
      continue;
    }
    if (slot === undefined) {
      violations.push(`unknown slot ${assignment.slotId}`);
      continue;
    }
    if (!oracleMayOccupy(player, slot)) {
      violations.push(`${player.id} may not occupy ${slot.id}`);
    }
  }

  for (const player of problem.players) {
    const count = assignmentsByPlayer.get(player.id) ?? 0;
    if (count !== 1) {
      violations.push(`${player.id} has ${count} assignments`);
    }
  }
  for (const slot of problem.slots) {
    const count = assignmentsBySlot.get(slot.id) ?? 0;
    if (count > slot.capacity) {
      violations.push(`${slot.id} has ${count} assignments for capacity ${slot.capacity}`);
    }
    if (slot.kind === "starting" && slot.requirement === "required" && count < slot.capacity) {
      violations.push(`${slot.id} has ${count} assignments but requires ${slot.capacity}`);
    }
  }

  return violations;
}

function expectAgreement(problem: LineupProblem): void {
  const result = solveLineup(problem);
  const oracle = solveTinyProblem(problem);

  if (oracle.kind === "infeasible") {
    if (result.kind !== "refusal") {
      throw new Error(
        `Solver returned a plan but the oracle found no legal assignment: ${JSON.stringify(problem)}`,
      );
    }
    return;
  }

  if (result.kind !== "plan") {
    throw new Error(
      `Solver refused (${result.refusal.reason}) but the oracle found value ${oracle.value}: ${JSON.stringify(problem)}`,
    );
  }

  expect(isLegalPlan(problem, result.plan)).toBe(true);
  expect(oracleLineupViolations(problem, result.plan.assignments)).toEqual([]);
  expect(result.plan.totalSelectionValue).toBe(oracle.value);
  expect(startingTierCounts(problem, result.plan.assignments)).toEqual(oracle.tierCounts);
  expect(zeroStartingPlayers(problem, result.plan.assignments)).toBe(oracle.zeroStarters);
  expect(result.plan.comparison.slotChanges).toHaveLength(oracle.changes);
}

function adversarialCases(): ReadonlyArray<{
  readonly name: string;
  readonly problem: LineupProblem;
}> {
  return [
    {
      name: "duplicate values",
      problem: lineupProblem(
        [
          startingSlot("S1", 1, "optional", ["A"]),
          startingSlot("S2", 1, "optional", ["A"]),
          benchSlot("BN", 2),
        ],
        [
          player("a", 5, { positions: ["A"] }),
          player("b", 5, { positions: ["A"] }),
          player("c", 0, { positions: ["A"] }),
        ],
      ),
    },
    {
      name: "all-equal values",
      problem: lineupProblem(
        [
          startingSlot("S1", 1, "required", ["A"]),
          startingSlot("S2", 1, "optional", ["A"]),
          benchSlot("BN", 2),
        ],
        [
          player("a", 0, { positions: ["A"] }),
          player("b", 0, { positions: ["A"] }),
          player("c", 0, { positions: ["A"] }),
        ],
      ),
    },
    {
      name: "players eligible for every position",
      problem: lineupProblem(
        [
          startingSlot("QB", 1, "required", []),
          startingSlot("FLEX", 1, "optional", []),
          benchSlot("BN", 2),
        ].map((slot) => ({ ...slot, eligibility: { kind: "any" as const } })),
        [
          player("a", 3, { positions: ["QB", "RB", "WR"] }),
          player("b", 2, { positions: ["QB", "RB", "WR"] }),
          player("c", -1, { positions: ["QB", "RB", "WR"] }),
        ],
      ),
    },
    {
      name: "players eligible for nothing",
      problem: lineupProblem(
        [startingSlot("S1", 1, "optional", ["A"]), benchSlot("BN", 2)],
        [player("a", 3, { positions: [] }), player("b", -1, { positions: [] })],
      ),
    },
    {
      name: "capacity larger than the roster",
      problem: lineupProblem(
        [startingSlot("FLEX", 3, "optional", ["A"]), benchSlot("BN", 3)],
        [player("a", 4, { positions: ["A"] }), player("b", -2, { positions: ["A"] })],
      ),
    },
    {
      name: "a lock that makes the high-value player unreachable",
      problem: lineupProblem(
        [
          startingSlot("S1", 1, "required", ["A"]),
          startingSlot("S2", 1, "optional", ["A"]),
          benchSlot("BN", 2),
        ],
        [
          player("locked", -2, { positions: ["A"], lockedSlotId: slotId("S1") }),
          player("high", 100, { positions: ["A"] }),
          player("zero", 0, { positions: ["A"] }),
        ],
      ),
    },
    {
      name: "negative values",
      problem: lineupProblem(
        [
          startingSlot("S1", 1, "optional", ["A"]),
          startingSlot("S2", 1, "optional", ["A"]),
          benchSlot("BN", 2),
        ],
        [
          player("a", -5, { positions: ["A"] }),
          player("b", -1, { positions: ["A"] }),
          player("c", -3, { positions: ["A"] }),
        ],
      ),
    },
    {
      name: "mixed signs and a required position",
      problem: lineupProblem(
        [
          startingSlot("S1", 1, "required", ["A"]),
          startingSlot("S2", 1, "optional", ["A"]),
          benchSlot("BN", 2),
        ],
        [
          player("a", 7, { positions: ["A"] }),
          player("b", -7, { positions: ["A"] }),
          player("c", 0, { positions: ["A"] }),
        ],
      ),
    },
    {
      name: "reserve and bench constraints",
      problem: lineupProblem(
        [reserveSlot("IR", 1), benchSlot("BN", 1), startingSlot("S1", 1, "optional", ["A"])],
        [
          player("healthy", 1, { positions: ["A"], reserveEligible: false }),
          player("reserve", 2, { positions: ["A"], reserveEligible: true }),
          player("other", 0, { positions: ["A"], reserveEligible: true }),
        ],
      ),
    },
    {
      name: "an already illegal roster",
      problem: lineupProblem(
        [benchSlot("BN", 1)],
        [player("a", 1, { positions: ["A"] }), player("b", 2, { positions: ["A"] })],
      ),
    },
    {
      name: "a high-value unavailable player against a low-value available player",
      problem: lineupProblem(
        [
          startingSlot("S1", 1, "required", ["A"]),
          startingSlot("S2", 2, "required", ["A"]),
          benchSlot("BN", 2),
        ],
        [
          player("available", 1, { positions: ["A"] }),
          player("unavailable", 100, { positions: ["A"], availabilityTier: willNotPlay }),
          player("doubtful", 50, { positions: ["A"], availabilityTier: mightPlay }),
          player("other", 0, { positions: ["A"] }),
        ],
      ),
    },
    {
      name: "an all-unavailable roster",
      problem: lineupProblem(
        [
          startingSlot("S1", 1, "required", ["A"]),
          startingSlot("S2", 1, "optional", ["A"]),
          benchSlot("BN", 2),
        ],
        [
          player("a", 0, { positions: ["A"], availabilityTier: willNotPlay }),
          player("b", -1, { positions: ["A"], availabilityTier: willNotPlay }),
          player("c", 4, { positions: ["A"], availabilityTier: willNotPlay }),
        ],
      ),
    },
    {
      name: "tiers tied against values",
      problem: lineupProblem(
        [
          startingSlot("S1", 1, "required", ["A"]),
          startingSlot("S2", 1, "optional", ["A"]),
          benchSlot("BN", 2),
        ],
        [
          player("a", 3, { positions: ["A"] }),
          player("b", 3, { positions: ["A"], availabilityTier: mightPlay }),
          player("c", 3, { positions: ["A"], availabilityTier: willNotPlay }),
        ],
      ),
    },
    {
      name: "a zero-valued available player against an unavailable star",
      problem: lineupProblem(
        [startingSlot("S1", 1, "required", ["A"]), benchSlot("BN", 1)],
        [
          player("zero", 0, { positions: ["A"] }),
          player("star", 100, { positions: ["A"], availabilityTier: willNotPlay }),
        ],
      ),
    },
    {
      name: "only an unavailable player for a vacant position",
      problem: lineupProblem(
        [startingSlot("S1", 1, "optional", ["A"]), benchSlot("BN", 1)],
        [player("hurt", 12, { positions: ["A"], availabilityTier: willNotPlay })],
      ),
    },
  ];
}

function generatedProblemArbitrary(): fc.Arbitrary<LineupProblem> {
  return fc
    .tuple(
      fc.constantFrom(...shapes),
      fc.array(slotArbitrary, { minLength: 0, maxLength: 3 }),
      fc.array(playerArbitrary, { minLength: 0, maxLength: 3 }),
    )
    .map(([shape, slotSpecs, playerSpecs]) => buildGeneratedProblem(shape, slotSpecs, playerSpecs));
}

function buildGeneratedProblem(
  shape: Shape,
  slotSpecs: ReadonlyArray<SlotSpec>,
  playerSpecs: ReadonlyArray<PlayerSpec>,
): LineupProblem {
  const effectivePlayerSpecs =
    shape === "capacity-over-roster" ? playerSpecs.slice(0, 1) : playerSpecs;
  const slots = slotSpecs.map((spec, index) => slotFromSpec(spec, index, shape));
  const slotIds = slots.map((slot) => slot.id);
  const players = effectivePlayerSpecs.map((spec, index) =>
    playerFromSpec(spec, index, shape, slotIds),
  );
  const lockedPlayers = shape === "locked" ? applyLockedShape(slots, players) : players;

  return { selectionBasis: basis, availabilityTiers: tiers, slots, players: lockedPlayers };
}

function slotFromSpec(spec: SlotSpec, index: number, shape: Shape): RosterSlot {
  const eligibility =
    shape === "all-eligible" ? { kind: "any" as const } : eligibilityFromSpec(spec.eligibility);
  const capacity = shape === "capacity-over-roster" ? 3 : spec.capacity;

  if (spec.kind === "starting-required") {
    return {
      kind: "starting",
      id: slotId(`S${index}`),
      capacity,
      requirement: "required",
      eligibility:
        shape === "none-eligible" ? { kind: "positions", positions: ["A"] } : eligibility,
    };
  }
  if (spec.kind === "starting-optional") {
    return {
      kind: "starting",
      id: slotId(`S${index}`),
      capacity,
      requirement: "optional",
      eligibility:
        shape === "none-eligible" ? { kind: "positions", positions: ["A"] } : eligibility,
    };
  }
  if (spec.kind === "bench") {
    return { kind: "bench", id: slotId(`S${index}`), capacity, eligibility };
  }
  return { kind: "reserve", id: slotId(`S${index}`), capacity, eligibility };
}

function playerFromSpec(
  spec: PlayerSpec,
  index: number,
  shape: Shape,
  slotIds: ReadonlyArray<SlotId>,
): RosterPlayer {
  const positions =
    shape === "all-eligible"
      ? ["A"]
      : shape === "none-eligible"
        ? []
        : positionsFromSpec(spec.positions);
  const units =
    shape === "all-equal"
      ? 2
      : shape === "duplicates"
        ? ([-1, 0, 1][index % 3] ?? 0)
        : shape === "negative"
          ? -(index % 3) - 1
          : shape === "zeros"
            ? 0
            : shape === "tier-against-value"
              ? 3 - index
              : spec.units;
  const availabilityTier =
    shape === "all-unavailable"
      ? willNotPlay
      : shape === "tier-against-value"
        ? (tiers[2 - (index % 3)] ?? willNotPlay)
        : (tiers[spec.tierOffset % 3] ?? willPlay);
  const lockedSlotId =
    spec.lockOffset === undefined || slotIds.length === 0
      ? undefined
      : slotIds[spec.lockOffset % slotIds.length];
  const currentSlotId =
    spec.currentOffset === undefined || slotIds.length === 0
      ? undefined
      : slotIds[spec.currentOffset % slotIds.length];

  return {
    id: playerId(`P${index}`),
    eligiblePositions: positions,
    availabilityTier,
    selection: knownSelection(basis, units),
    reserveEligible: spec.reserveEligible,
    lockedSlotId,
    currentSlotId,
  };
}

function applyLockedShape(
  slots: ReadonlyArray<RosterSlot>,
  players: ReadonlyArray<RosterPlayer>,
): ReadonlyArray<RosterPlayer> {
  const startingSlot = slots.find((slot) => slot.kind === "starting");
  const firstPlayer = players[0];
  if (startingSlot === undefined || firstPlayer === undefined) {
    return players;
  }
  const lockedPositions =
    startingSlot.eligibility.kind === "positions" && startingSlot.eligibility.positions.length === 0
      ? undefined
      : startingSlot.eligibility.kind === "positions"
        ? startingSlot.eligibility.positions
        : ["A"];

  if (lockedPositions === undefined) {
    return players;
  }

  return players.map((player, index) =>
    index === 0
      ? {
          ...player,
          eligiblePositions: lockedPositions,
          selection: knownSelection(basis, -2),
          lockedSlotId: startingSlot.id,
        }
      : { ...player, lockedSlotId: undefined },
  );
}

function eligibilityFromSpec(spec: EligibilitySpec): RosterSlot["eligibility"] {
  if (spec === "any") {
    return { kind: "any" };
  }
  return { kind: "positions", positions: positionsFromSpec(spec) };
}

function positionsFromSpec(spec: PositionSpec | EligibilitySpec): ReadonlyArray<string> {
  if (spec === "none" || spec === "empty" || spec === "any") {
    return [];
  }
  if (spec === "A") {
    return ["A"];
  }
  if (spec === "B") {
    return ["B"];
  }
  if (spec === "AB") {
    return ["A", "B"];
  }
  return ["A", "B", "C"];
}

type OracleResult =
  | {
      readonly kind: "optimal";
      readonly tierCounts: ReadonlyArray<number>;
      readonly value: number;
      readonly zeroStarters: number;
      readonly changes: number;
      readonly assignments: ReadonlyArray<LineupAssignment>;
    }
  | { readonly kind: "infeasible" };

type OracleUnit = {
  readonly index: number;
  readonly slot: RosterSlot;
  readonly lockedPlayerId: PlayerId | undefined;
};

type OracleCandidate = {
  readonly tierCounts: ReadonlyArray<number>;
  readonly value: number;
  readonly zeroStarters: number;
  readonly changes: number;
  readonly assignments: ReadonlyArray<LineupAssignment>;
};

function solveTinyProblem(problem: LineupProblem): OracleResult {
  const players = [...problem.players].sort((left, right) => compareText(left.id, right.id));
  if (players.some((player) => player.selection.kind !== "known")) {
    throw new Error("The exhaustive oracle requires known selection values.");
  }
  const slotsById = new Map(problem.slots.map((slot) => [slot.id, slot]));
  for (const player of players) {
    if (player.lockedSlotId !== undefined && !slotsById.has(player.lockedSlotId)) {
      return { kind: "infeasible" };
    }
  }

  const units = buildOracleUnits(problem.slots, players);
  if (units === undefined) {
    return { kind: "infeasible" };
  }

  const lockedPlayerIds = new Set(
    players.filter((player) => player.lockedSlotId !== undefined).map((player) => player.id),
  );
  const unassigned = new Set(
    players.filter((player) => !lockedPlayerIds.has(player.id)).map((player) => player.id),
  );
  const assignment = new Map<PlayerId, SlotId>();
  for (const unit of units) {
    if (unit.lockedPlayerId !== undefined) {
      assignment.set(unit.lockedPlayerId, unit.slot.id);
    }
  }

  let best: OracleCandidate | undefined;

  const search = (unitIndex: number): void => {
    if (units.length - unitIndex < unassigned.size) {
      return;
    }
    if (unitIndex === units.length) {
      if (unassigned.size === 0) {
        const candidate = evaluateOracleAssignment(problem, players, assignment);
        if (best === undefined || compareCandidates(candidate, best) < 0) {
          best = candidate;
        }
      }
      return;
    }

    const unit = units[unitIndex];
    if (unit === undefined) {
      return;
    }
    if (unit.lockedPlayerId !== undefined) {
      search(unitIndex + 1);
      return;
    }

    for (const player of players) {
      if (!unassigned.has(player.id) || !oracleMayOccupy(player, unit.slot)) {
        continue;
      }
      unassigned.delete(player.id);
      assignment.set(player.id, unit.slot.id);
      search(unitIndex + 1);
      assignment.delete(player.id);
      unassigned.add(player.id);
    }

    if (oracleMayStayEmpty(unit.slot)) {
      search(unitIndex + 1);
    }
  };

  search(0);

  if (best === undefined) {
    return { kind: "infeasible" };
  }

  return {
    kind: "optimal",
    tierCounts: best.tierCounts,
    value: best.value,
    zeroStarters: best.zeroStarters,
    changes: best.changes,
    assignments: best.assignments,
  };
}

function buildOracleUnits(
  slots: ReadonlyArray<RosterSlot>,
  players: ReadonlyArray<RosterPlayer>,
): ReadonlyArray<OracleUnit> | undefined {
  const lockedBySlot = new Map<SlotId, Array<RosterPlayer>>();
  for (const player of players) {
    if (player.lockedSlotId === undefined) {
      continue;
    }
    const locked = lockedBySlot.get(player.lockedSlotId) ?? [];
    locked.push(player);
    lockedBySlot.set(player.lockedSlotId, locked);
  }

  const units: Array<OracleUnit> = [];
  let index = 0;
  for (const slot of slots) {
    const locked = lockedBySlot.get(slot.id) ?? [];
    if (locked.length > slot.capacity) {
      return undefined;
    }
    for (const player of locked) {
      if (!oracleMayOccupy(player, slot)) {
        return undefined;
      }
      units.push({ index, slot, lockedPlayerId: player.id });
      index += 1;
    }
    for (let open = locked.length; open < slot.capacity; open += 1) {
      units.push({ index, slot, lockedPlayerId: undefined });
      index += 1;
    }
  }

  return units;
}

function oracleMayOccupy(player: RosterPlayer, slot: RosterSlot): boolean {
  if (player.lockedSlotId !== undefined && player.lockedSlotId !== slot.id) {
    return false;
  }
  if (slot.kind === "reserve" && !player.reserveEligible) {
    return false;
  }
  const eligibility = slot.eligibility;
  if (eligibility.kind === "any") {
    return true;
  }
  return player.eligiblePositions.some((position) => eligibility.positions.includes(position));
}

function oracleMayStayEmpty(slot: RosterSlot): boolean {
  return !(slot.kind === "starting" && slot.requirement === "required");
}

function evaluateOracleAssignment(
  problem: LineupProblem,
  players: ReadonlyArray<RosterPlayer>,
  assignment: ReadonlyMap<PlayerId, SlotId>,
): OracleCandidate {
  const slotsById = new Map(problem.slots.map((slot) => [slot.id, slot]));
  const tierCounts = problem.availabilityTiers.map(() => 0);
  let value = 0;
  let zeroStarters = 0;
  let changes = 0;
  const assignments: Array<LineupAssignment> = [];

  for (const player of players) {
    const assignedSlotId = assignment.get(player.id);
    if (assignedSlotId === undefined) {
      throw new Error("The exhaustive oracle produced an incomplete assignment.");
    }
    const slot = slotsById.get(assignedSlotId);
    if (slot === undefined) {
      throw new Error("The exhaustive oracle produced an unknown slot assignment.");
    }
    if (player.selection.kind !== "known") {
      throw new Error("The exhaustive oracle requires known selection values.");
    }
    if (slot.kind === "starting") {
      value += player.selection.units;
      if (player.selection.units === 0) {
        zeroStarters += 1;
      }
      if (player.selection.units >= 0) {
        const rank = problem.availabilityTiers.indexOf(player.availabilityTier);
        tierCounts[rank] = (tierCounts[rank] ?? 0) + 1;
      }
    }
    if (player.currentSlotId !== assignedSlotId) {
      changes += 1;
    }
    assignments.push({ playerId: player.id, slotId: assignedSlotId });
  }

  assignments.sort(compareAssignments);
  return { tierCounts, value, zeroStarters, changes, assignments };
}

function compareCandidates(left: OracleCandidate, right: OracleCandidate): number {
  for (let rank = 0; rank < left.tierCounts.length; rank += 1) {
    const leftCount = left.tierCounts[rank] ?? 0;
    const rightCount = right.tierCounts[rank] ?? 0;
    if (leftCount !== rightCount) {
      return rightCount - leftCount;
    }
  }
  if (left.value !== right.value) {
    return right.value - left.value;
  }
  if (left.zeroStarters !== right.zeroStarters) {
    return right.zeroStarters - left.zeroStarters;
  }
  if (left.changes !== right.changes) {
    return left.changes - right.changes;
  }
  return compareAssignmentLists(left.assignments, right.assignments);
}

function compareAssignmentLists(
  left: ReadonlyArray<LineupAssignment>,
  right: ReadonlyArray<LineupAssignment>,
): number {
  const limit = Math.min(left.length, right.length);
  for (let index = 0; index < limit; index += 1) {
    const leftAssignment = left[index];
    const rightAssignment = right[index];
    if (leftAssignment === undefined || rightAssignment === undefined) {
      break;
    }
    const compared = compareAssignments(leftAssignment, rightAssignment);
    if (compared !== 0) {
      return compared;
    }
  }
  return left.length - right.length;
}

function compareAssignments(left: LineupAssignment, right: LineupAssignment): number {
  return compareText(left.playerId, right.playerId) || compareText(left.slotId, right.slotId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function zeroStartingPlayers(
  problem: LineupProblem,
  assignments: ReadonlyArray<LineupAssignment>,
): number {
  const playersById = new Map(problem.players.map((player) => [player.id, player]));
  const slotsById = new Map(problem.slots.map((slot) => [slot.id, slot]));
  return assignments.filter((assignment) => {
    const player = playersById.get(assignment.playerId);
    const slot = slotsById.get(assignment.slotId);
    return (
      player !== undefined &&
      player.selection.kind === "known" &&
      player.selection.units === 0 &&
      slot?.kind === "starting"
    );
  }).length;
}

function compareObjectives(left: ReadonlyArray<number>, right: ReadonlyArray<number>): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function objectiveOf(problem: LineupProblem, plan: LineupPlan): ReadonlyArray<number> {
  return [
    ...startingTierCounts(problem, plan.assignments).map((count) => -count),
    -plan.totalSelectionValue,
  ];
}

function startingTierCounts(
  problem: LineupProblem,
  assignments: ReadonlyArray<LineupAssignment>,
): ReadonlyArray<number> {
  const playersById = new Map(problem.players.map((player) => [player.id, player]));
  const slotsById = new Map(problem.slots.map((slot) => [slot.id, slot]));
  const counts = problem.availabilityTiers.map(() => 0);

  for (const assignment of assignments) {
    const player = playersById.get(assignment.playerId);
    const slot = slotsById.get(assignment.slotId);
    if (player === undefined || slot?.kind !== "starting") {
      continue;
    }
    if (player.selection.kind !== "known" || player.selection.units < 0) {
      continue;
    }
    const rank = problem.availabilityTiers.indexOf(player.availabilityTier);
    counts[rank] = (counts[rank] ?? 0) + 1;
  }

  return counts;
}

function lineupProblem(
  slots: ReadonlyArray<RosterSlot>,
  players: ReadonlyArray<RosterPlayer>,
): LineupProblem {
  return { selectionBasis: basis, availabilityTiers: tiers, slots, players };
}

function startingSlot(
  id: string,
  capacity: number,
  requirement: "required" | "optional",
  positions: ReadonlyArray<string>,
): RosterSlot {
  return {
    kind: "starting",
    id: slotId(id),
    capacity,
    requirement,
    eligibility: { kind: "positions", positions },
  };
}

function benchSlot(id: string, capacity: number): RosterSlot {
  return { kind: "bench", id: slotId(id), capacity, eligibility: { kind: "any" } };
}

function reserveSlot(id: string, capacity: number): RosterSlot {
  return { kind: "reserve", id: slotId(id), capacity, eligibility: { kind: "any" } };
}

function player(
  id: string,
  units: number,
  options: {
    readonly positions: ReadonlyArray<string>;
    readonly availabilityTier?: AvailabilityTier;
    readonly reserveEligible?: boolean;
    readonly lockedSlotId?: SlotId;
    readonly currentSlotId?: SlotId;
  },
): RosterPlayer {
  return {
    id: playerId(id),
    eligiblePositions: options.positions,
    availabilityTier: options.availabilityTier ?? willPlay,
    selection: knownSelection(basis, units),
    reserveEligible: options.reserveEligible ?? false,
    lockedSlotId: options.lockedSlotId,
    currentSlotId: options.currentSlotId,
  };
}

function playerId(value: string): PlayerId {
  return makePlayerId(value);
}

function slotId(value: string): SlotId {
  return makeSlotId(value);
}

type Shape =
  | "mixed"
  | "all-equal"
  | "duplicates"
  | "negative"
  | "zeros"
  | "all-eligible"
  | "none-eligible"
  | "capacity-over-roster"
  | "locked"
  | "all-unavailable"
  | "tier-against-value";

const shapes: ReadonlyArray<Shape> = [
  "mixed",
  "all-equal",
  "duplicates",
  "negative",
  "zeros",
  "all-eligible",
  "none-eligible",
  "capacity-over-roster",
  "locked",
  "all-unavailable",
  "tier-against-value",
];

type SlotSpec = {
  readonly kind: "starting-required" | "starting-optional" | "bench" | "reserve";
  readonly capacity: number;
  readonly eligibility: EligibilitySpec;
};

type EligibilitySpec = "any" | "A" | "B" | "AB" | "empty";

type PositionSpec = "none" | "A" | "B" | "AB" | "ABC";

type PlayerSpec = {
  readonly positions: PositionSpec;
  readonly units: number;
  readonly tierOffset: number;
  readonly reserveEligible: boolean;
  readonly lockOffset: number | undefined;
  readonly currentOffset: number | undefined;
};

const slotArbitrary: fc.Arbitrary<SlotSpec> = fc.record({
  kind: fc.constantFrom("starting-required", "starting-optional", "bench", "reserve"),
  capacity: fc.integer({ min: 1, max: 3 }),
  eligibility: fc.constantFrom("any", "A", "B", "AB", "empty"),
});

const playerArbitrary: fc.Arbitrary<PlayerSpec> = fc.record({
  positions: fc.constantFrom("none", "A", "B", "AB", "ABC"),
  units: fc.integer({ min: -3, max: 3 }),
  tierOffset: fc.integer({ min: 0, max: 5 }),
  reserveEligible: fc.boolean(),
  lockOffset: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }),
  currentOffset: fc.option(fc.integer({ min: 0, max: 3 }), { nil: undefined }),
});
