import { describe, expect, it } from "vitest";

import {
  compareWithCurrentLineup,
  isLegalLineup,
  isLegalPlan,
  lineupViolations,
  planViolations,
  playerMayOccupySlot,
  startingSelectionValue,
} from "./lineup.ts";
import {
  knownSelection,
  makePlayerId,
  makeSelectionBasis,
  makeSlotId,
  unusableSelection,
} from "./types.ts";
import type {
  BenchSlot,
  LineupAssignment,
  LineupPlan,
  LineupProblem,
  PlayerId,
  RosterPlayer,
  ReserveSlot,
  SlotId,
  StartingSlot,
} from "./types.ts";

const basis = makeSelectionBasis("test-basis");

describe("lineup legality", () => {
  it("accepts a complete legal assignment", () => {
    const problem = problemWithTwoStartersAndBench();

    const assignments = [assignment("a", "QB"), assignment("b", "RB"), assignment("c", "BN")];

    expect(lineupViolations(problem, assignments)).toEqual([]);
    expect(isLegalLineup(problem, assignments)).toBe(true);
  });

  it("reports a roster member without an assignment", () => {
    const problem = problemWithTwoStartersAndBench();

    const violations = lineupViolations(problem, [assignment("a", "QB"), assignment("b", "RB")]);

    expect(violations).toContainEqual({ reason: "player-not-assigned", playerId: playerId("c") });
    expect(isLegalLineup(problem, [assignment("a", "QB"), assignment("b", "RB")])).toBe(false);
  });

  it("reports an assignment for an unknown player", () => {
    const problem = problemWithTwoStartersAndBench();

    const violations = lineupViolations(problem, [
      assignment("a", "QB"),
      assignment("b", "RB"),
      assignment("c", "BN"),
      assignment("ghost", "BN"),
    ]);

    expect(violations).toContainEqual({ reason: "unknown-player", playerId: playerId("ghost") });
  });

  it("reports an assignment for an unknown slot", () => {
    const problem = problemWithTwoStartersAndBench();

    const violations = lineupViolations(problem, [
      assignment("a", "QB"),
      assignment("b", "RB"),
      assignment("c", "GHOST"),
    ]);

    expect(violations).toContainEqual({ reason: "unknown-slot", slotId: slotId("GHOST") });
  });

  it("reports a player assigned more than once", () => {
    const problem = problemWithTwoStartersAndBench();

    const violations = lineupViolations(problem, [
      assignment("a", "QB"),
      assignment("a", "RB"),
      assignment("c", "BN"),
    ]);

    expect(violations).toContainEqual({
      reason: "player-assigned-more-than-once",
      playerId: playerId("a"),
    });
  });

  it("reports a slot beyond its capacity", () => {
    const problem = problemWithTwoStartersAndBench();

    const violations = lineupViolations(problem, [
      assignment("a", "QB"),
      assignment("b", "QB"),
      assignment("c", "BN"),
    ]);

    expect(violations).toContainEqual({
      reason: "slot-capacity-exceeded",
      slotId: slotId("QB"),
      capacity: 1,
      assignedPlayers: 2,
    });
  });

  it("reports positional ineligibility", () => {
    const problem = problemWithTwoStartersAndBench();

    const violations = lineupViolations(problem, [
      assignment("a", "QB"),
      assignment("c", "RB"),
      assignment("b", "BN"),
    ]);

    expect(violations).toContainEqual({
      reason: "player-ineligible-for-slot",
      playerId: playerId("c"),
      slotId: slotId("RB"),
    });
  });

  it("reports reserve ineligibility separately from positional ineligibility", () => {
    const problem: LineupProblem = {
      selectionBasis: basis,
      slots: [reserveSlot("IR", 1), benchSlot("BN", 1)],
      players: [
        player("a", { selection: knownSelection(basis, 1), reserveEligible: false }),
        player("b", { selection: knownSelection(basis, 1), reserveEligible: true }),
      ],
    };

    const violations = lineupViolations(problem, [assignment("a", "IR"), assignment("b", "BN")]);

    expect(violations).toContainEqual({
      reason: "player-ineligible-for-reserve",
      playerId: playerId("a"),
      slotId: slotId("IR"),
    });
  });

  it("reports a violated lock", () => {
    const problem = problemWithTwoStartersAndBench();

    const violations = lineupViolations(problem, [
      assignment("a", "RB"),
      assignment("b", "QB"),
      assignment("c", "BN"),
    ]);

    expect(violations).toContainEqual({
      reason: "lock-violated",
      playerId: playerId("a"),
      lockedSlotId: slotId("QB"),
      assignedSlotId: slotId("RB"),
    });
  });

  it("reports an unfilled required starting position", () => {
    const problem: LineupProblem = {
      selectionBasis: basis,
      slots: [startingSlot("QB", 1, "required", ["QB"]), benchSlot("BN", 1)],
      players: [player("a", { selection: knownSelection(basis, 1) })],
    };

    const violations = lineupViolations(problem, [assignment("a", "BN")]);

    expect(violations).toContainEqual({
      reason: "required-starting-position-unfilled",
      slotId: slotId("QB"),
      capacity: 1,
      filled: 0,
    });
  });

  it("reports a started player whose selection value is unusable", () => {
    const problem: LineupProblem = {
      selectionBasis: basis,
      slots: [startingSlot("QB", 1, "optional", ["QB"]), benchSlot("BN", 1)],
      players: [player("a", { selection: unusableSelection(basis, "missing") })],
    };

    const violations = lineupViolations(problem, [assignment("a", "QB")]);

    expect(violations).toContainEqual({
      reason: "unusable-selection-value-started",
      playerId: playerId("a"),
    });
  });

  it("reports mixed selection bases", () => {
    const otherBasis = makeSelectionBasis("other-basis");
    const problem: LineupProblem = {
      selectionBasis: basis,
      slots: [benchSlot("BN", 2)],
      players: [
        player("a", { selection: knownSelection(otherBasis, 1) }),
        player("b", { selection: knownSelection(basis, 1) }),
      ],
    };

    const violations = lineupViolations(problem, [assignment("a", "BN"), assignment("b", "BN")]);

    expect(violations).toContainEqual({
      reason: "selection-basis-mismatch",
      playerIds: [playerId("a")],
    });
  });

  it("reports a plan carrying a different selection basis", () => {
    const otherBasis = makeSelectionBasis("other-basis");
    const problem = problemWithTwoStartersAndBench();
    const plan = legalPlan(problem, [
      assignment("a", "QB"),
      assignment("b", "RB"),
      assignment("c", "BN"),
    ]);

    const violations = planViolations(problem, { ...plan, selectionBasis: otherBasis });

    expect(violations).toContainEqual({
      reason: "plan-selection-basis-mismatch",
      problemBasis: basis,
      planBasis: otherBasis,
    });
  });

  it("reports a stated value that differs from the assignment", () => {
    const problem = problemWithTwoStartersAndBench();
    const plan = legalPlan(problem, [
      assignment("a", "QB"),
      assignment("b", "RB"),
      assignment("c", "BN"),
    ]);

    const violations = planViolations(problem, { ...plan, totalSelectionValue: 999 });

    expect(violations).toContainEqual({
      reason: "selection-value-mismatch",
      stated: 999,
      recomputed: plan.totalSelectionValue,
    });
    expect(isLegalPlan(problem, plan)).toBe(true);
    expect(isLegalPlan(problem, { ...plan, totalSelectionValue: 999 })).toBe(false);
  });

  it("reports a stated starting occupancy that differs from the assignment", () => {
    const problem = problemWithTwoStartersAndBench();
    const plan = legalPlan(problem, [
      assignment("a", "QB"),
      assignment("b", "RB"),
      assignment("c", "BN"),
    ]);

    const violations = planViolations(problem, { ...plan, filledStartingPositions: 1 });

    expect(violations).toContainEqual({
      reason: "filled-starting-position-count-mismatch",
      stated: 1,
      recomputed: 2,
    });
  });
});

describe("lineup comparison", () => {
  it("reports added and removed starters and slot changes", () => {
    const problem = problemWithTwoStartersAndBench();
    const comparison = compareWithCurrentLineup(problem, [
      assignment("a", "QB"),
      assignment("b", "RB"),
      assignment("c", "BN"),
    ]);

    expect(comparison).toEqual({
      addedStarters: [playerId("b")],
      removedStarters: [],
      slotChanges: [{ playerId: playerId("b"), fromSlotId: slotId("BN"), toSlotId: slotId("RB") }],
    });
  });

  it("reports a player removed from the starting lineup", () => {
    const problem: LineupProblem = {
      selectionBasis: basis,
      slots: [
        startingSlot("QB", 1, "required", ["QB"]),
        startingSlot("RB", 1, "required", ["RB"]),
        benchSlot("BN", 2),
      ],
      players: [
        player("a", {
          selection: knownSelection(basis, 10),
          positions: ["QB"],
          currentSlotId: slotId("QB"),
        }),
        player("b", {
          selection: knownSelection(basis, 20),
          positions: ["RB"],
          currentSlotId: slotId("BN"),
        }),
        player("c", {
          selection: knownSelection(basis, 0),
          positions: ["RB"],
          currentSlotId: slotId("RB"),
        }),
      ],
    };

    const comparison = compareWithCurrentLineup(problem, [
      assignment("a", "QB"),
      assignment("b", "RB"),
      assignment("c", "BN"),
    ]);

    expect(comparison.addedStarters).toEqual([playerId("b")]);
    expect(comparison.removedStarters).toEqual([playerId("c")]);
  });
});

describe("selection value", () => {
  it("sums only starting assignments", () => {
    const problem = problemWithTwoStartersAndBench();

    const value = startingSelectionValue(problem, [
      assignment("a", "QB"),
      assignment("b", "RB"),
      assignment("c", "BN"),
    ]);

    expect(value).toBe(30);
  });

  it("has no value when a starter has an unusable selection", () => {
    const problem: LineupProblem = {
      selectionBasis: basis,
      slots: [startingSlot("QB", 1, "optional", ["QB"]), benchSlot("BN", 1)],
      players: [player("a", { selection: unusableSelection(basis, "missing") })],
    };

    expect(startingSelectionValue(problem, [assignment("a", "QB")])).toBeUndefined();
  });
});

describe("slot occupancy", () => {
  it("respects position eligibility, reserve eligibility, and locks", () => {
    const qbSlot = startingSlot("QB", 1, "required", ["QB"]);
    const reserve = reserveSlot("IR", 1);
    const qbPlayer = player("a", {
      selection: knownSelection(basis, 1),
      positions: ["QB"],
      reserveEligible: false,
    });
    const lockedQuarterback = player("b", {
      selection: knownSelection(basis, 1),
      positions: ["QB"],
      lockedSlotId: slotId("QB"),
    });

    expect(playerMayOccupySlot(qbPlayer, qbSlot)).toBe(true);
    expect(playerMayOccupySlot(qbPlayer, reserve)).toBe(false);
    expect(playerMayOccupySlot(lockedQuarterback, qbSlot)).toBe(true);
    expect(playerMayOccupySlot(lockedQuarterback, reserve)).toBe(false);
  });
});

function problemWithTwoStartersAndBench(): LineupProblem {
  return {
    selectionBasis: basis,
    slots: [
      startingSlot("QB", 1, "required", ["QB"]),
      startingSlot("RB", 1, "required", ["RB"]),
      benchSlot("BN", 2),
    ],
    players: [
      player("a", {
        selection: knownSelection(basis, 10),
        positions: ["QB"],
        lockedSlotId: slotId("QB"),
        currentSlotId: slotId("QB"),
      }),
      player("b", {
        selection: knownSelection(basis, 20),
        positions: ["RB"],
        currentSlotId: slotId("BN"),
      }),
      player("c", {
        selection: knownSelection(basis, 0),
        positions: ["QB"],
        currentSlotId: slotId("BN"),
      }),
    ],
  };
}

function legalPlan(
  problem: LineupProblem,
  assignments: ReadonlyArray<LineupAssignment>,
): LineupPlan {
  const value = startingSelectionValue(problem, assignments);
  const startingSlots = new Set(
    problem.slots.filter((slot) => slot.kind === "starting").map((slot) => slot.id),
  );

  return {
    selectionBasis: problem.selectionBasis,
    assignments,
    totalSelectionValue: value ?? 0,
    filledStartingPositions: assignments.filter((item) => startingSlots.has(item.slotId)).length,
    requiredStartingPositions: problem.slots
      .filter((slot) => slot.kind === "starting" && slot.requirement === "required")
      .reduce((total, slot) => total + slot.capacity, 0),
    comparison: compareWithCurrentLineup(problem, assignments),
  };
}

function assignment(player: string, slot: string): LineupAssignment {
  return { playerId: playerId(player), slotId: slotId(slot) };
}

function startingSlot(
  id: string,
  capacity: number,
  requirement: "required" | "optional",
  positions: ReadonlyArray<string>,
): StartingSlot {
  return {
    kind: "starting",
    id: slotId(id),
    capacity,
    requirement,
    eligibility: { kind: "positions", positions },
  };
}

function benchSlot(id: string, capacity: number): BenchSlot {
  return { kind: "bench", id: slotId(id), capacity, eligibility: { kind: "any" } };
}

function reserveSlot(id: string, capacity: number): ReserveSlot {
  return { kind: "reserve", id: slotId(id), capacity, eligibility: { kind: "any" } };
}

function player(
  id: string,
  options: {
    readonly selection: RosterPlayer["selection"];
    readonly positions?: ReadonlyArray<string>;
    readonly reserveEligible?: boolean;
    readonly lockedSlotId?: SlotId;
    readonly currentSlotId?: SlotId;
  },
): RosterPlayer {
  return {
    id: playerId(id),
    eligiblePositions: options.positions ?? ["QB", "RB"],
    selection: options.selection,
    reserveEligible: options.reserveEligible ?? true,
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
