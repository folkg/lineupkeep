import { describe, expect, it } from "vitest";

import { isLegalPlan } from "./lineup.ts";
import { solveLineup } from "./solve.ts";
import {
  knownSelection,
  makeAvailabilityTier,
  makePlayerId,
  makeSelectionBasis,
  makeSlotId,
  unusableSelection,
} from "./types.ts";
import type {
  AvailabilityTier,
  BenchSlot,
  LineupAssignment,
  LineupPlan,
  LineupProblem,
  LineupRefusal,
  LineupSolveResult,
  PlayerId,
  PlayerSelection,
  RosterPlayer,
  RosterSlot,
  SlotEligibility,
  SlotId,
  StartingSlot,
} from "./types.ts";

const basis = makeSelectionBasis("test-basis");
const willPlay = makeAvailabilityTier("will-play");
const mightPlay = makeAvailabilityTier("might-play");
const willNotPlay = makeAvailabilityTier("will-not-play");
const tiers = [willPlay, mightPlay, willNotPlay];

describe("lineup optimization", () => {
  it("starts the highest-value legal players across flexible positions", () => {
    const problem = lineupProblem(
      [
        startingSlot("QB", 1, "required", ["QB"]),
        startingSlot("RB", 2, "required", ["RB"]),
        startingSlot("FLEX", 1, "optional", ["RB", "WR"]),
        benchSlot("BN", 3),
      ],
      [
        player("qb1", 120, { positions: ["QB"] }),
        player("rb1", 100, { positions: ["RB"] }),
        player("rb2", 90, { positions: ["RB"] }),
        player("wr1", 80, { positions: ["WR"] }),
      ],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([
      assignment("qb1", "QB"),
      assignment("rb1", "RB"),
      assignment("rb2", "RB"),
      assignment("wr1", "FLEX"),
    ]);
    expect(plan.totalSelectionValue).toBe(390);
    expect(plan.filledStartingPositions).toBe(4);
    expect(plan.requiredStartingPositions).toBe(3);
    expect(isLegalPlan(problem, plan)).toBe(true);
  });

  it("leaves an optional starting position empty for a negative player when bench accommodation exists", () => {
    const problem = lineupProblem(
      [startingSlot("FLEX", 1, "optional", ["RB"]), benchSlot("BN", 1)],
      [player("negative", -5, { positions: ["RB"] })],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("negative", "BN")]);
    expect(plan.totalSelectionValue).toBe(0);
    expect(plan.filledStartingPositions).toBe(0);
    expect(isLegalPlan(problem, plan)).toBe(true);
  });

  it("fills a required starting position with a negative player rather than dropping the player", () => {
    const problem = lineupProblem(
      [startingSlot("FLEX", 1, "required", ["RB"]), benchSlot("BN", 1)],
      [player("negative", -5, { positions: ["RB"] })],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("negative", "FLEX")]);
    expect(plan.totalSelectionValue).toBe(-5);
    expect(isLegalPlan(problem, plan)).toBe(true);
  });

  it("keeps a negative player in a locked optional starting position", () => {
    const problem = lineupProblem(
      [startingSlot("FLEX", 1, "optional", ["RB"]), benchSlot("BN", 1)],
      [player("negative", -5, { positions: ["RB"], lockedSlotId: slotId("FLEX") })],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("negative", "FLEX")]);
    expect(plan.totalSelectionValue).toBe(-5);
  });

  it("starts a zero-valued player in an optional starting position ahead of an empty slot", () => {
    const problem = lineupProblem(
      [startingSlot("FLEX", 1, "optional", ["RB"]), benchSlot("BN", 1)],
      [player("zero", 0, { positions: ["RB"] })],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("zero", "FLEX")]);
    expect(plan.filledStartingPositions).toBe(1);
    expect(plan.totalSelectionValue).toBe(0);
  });

  it("honours a low-value locked starter and starts the higher-value player elsewhere", () => {
    const problem = lineupProblem(
      [
        startingSlot("S1", 1, "required", ["RB"]),
        startingSlot("S2", 1, "optional", ["RB"]),
        benchSlot("BN", 1),
      ],
      [
        player("locked", 1, { positions: ["RB"], lockedSlotId: slotId("S1") }),
        player("high", 100, { positions: ["RB"] }),
      ],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("high", "S2"), assignment("locked", "S1")]);
    expect(plan.totalSelectionValue).toBe(101);
  });

  it("places a reserve-eligible player on the reserve list and an ineligible player on the bench", () => {
    const problem = lineupProblem(
      [reserveSlot("IR", 1), benchSlot("BN", 1)],
      [
        player("eligible", 1, { reserveEligible: true }),
        player("ineligible", 2, { reserveEligible: false }),
      ],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([
      assignment("eligible", "IR"),
      assignment("ineligible", "BN"),
    ]);
    expect(plan.totalSelectionValue).toBe(0);
  });

  it("uses multiple eligible positions without inventing a starting place", () => {
    const problem = lineupProblem(
      [
        startingSlot("RB", 1, "required", ["RB"]),
        startingSlot("WR", 1, "required", ["WR"]),
        benchSlot("BN", 2),
      ],
      [
        player("flex", 10, { positions: ["RB", "WR"] }),
        player("receiver", 5, { positions: ["WR"] }),
      ],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("flex", "RB"), assignment("receiver", "WR")]);
    expect(plan.totalSelectionValue).toBe(15);
  });

  it("fills every unit of a slot with capacity greater than one", () => {
    const problem = lineupProblem(
      [startingSlot("RB", 2, "required", ["RB"]), benchSlot("BN", 2)],
      [player("rb1", 10, { positions: ["RB"] }), player("rb2", 20, { positions: ["RB"] })],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("rb1", "RB"), assignment("rb2", "RB")]);
    expect(plan.filledStartingPositions).toBe(2);
    expect(plan.totalSelectionValue).toBe(30);
  });

  it("minimizes slot changes among equal-value plans", () => {
    const problem = lineupProblem(
      [startingSlot("RB1", 1, "optional", ["RB"]), startingSlot("RB2", 1, "optional", ["RB"])],
      [
        player("a", 10, { positions: ["RB"], currentSlotId: slotId("RB1") }),
        player("b", 10, { positions: ["RB"], currentSlotId: slotId("RB2") }),
      ],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("a", "RB1"), assignment("b", "RB2")]);
    expect(plan.comparison.slotChanges).toEqual([]);
  });

  it("keeps a better primary value ahead of change and occupancy tie-breaks at the safe-integer boundary", () => {
    const high = Number.MAX_SAFE_INTEGER - 1;
    const low = Number.MAX_SAFE_INTEGER - 2;
    const problem = lineupProblem(
      [startingSlot("S1", 1, "optional", ["A"]), benchSlot("BN", 1)],
      [
        player("high", high, { positions: ["A"], currentSlotId: slotId("BN") }),
        player("low", low, { positions: ["A"], currentSlotId: slotId("S1") }),
      ],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("high", "S1"), assignment("low", "BN")]);
    expect(plan.totalSelectionValue).toBe(high);
    expect(plan.comparison.slotChanges).toHaveLength(2);
  });

  it("prefers zero-value occupancy before minimizing changes", () => {
    const problem = lineupProblem(
      [startingSlot("FLEX", 1, "optional", ["RB"]), benchSlot("BN", 1)],
      [player("zero", 0, { positions: ["RB"], currentSlotId: slotId("BN") })],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("zero", "FLEX")]);
    expect(plan.comparison.slotChanges).toHaveLength(1);
  });

  it("keeps a locked bench player on the bench", () => {
    const problem = lineupProblem(
      [startingSlot("FLEX", 1, "optional", ["RB"]), benchSlot("BN", 1)],
      [player("benched", 50, { positions: ["RB"], lockedSlotId: slotId("BN") })],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("benched", "BN")]);
    expect(plan.filledStartingPositions).toBe(0);
  });

  it("leaves empty optional capacity when the roster is smaller than the slots", () => {
    const problem = lineupProblem(
      [startingSlot("FLEX", 3, "optional", ["RB"]), benchSlot("BN", 2)],
      [player("only", 1, { positions: ["RB"] })],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("only", "FLEX")]);
    expect(plan.filledStartingPositions).toBe(1);
    expect(isLegalPlan(problem, plan)).toBe(true);
  });

  it("forces a negative player into an optional starting position when no bench exists", () => {
    const problem = lineupProblem(
      [startingSlot("FLEX", 1, "optional", ["RB"])],
      [player("negative", -5, { positions: ["RB"] })],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("negative", "FLEX")]);
    expect(plan.totalSelectionValue).toBe(-5);
  });

  it("returns an empty plan for an empty problem", () => {
    const problem = lineupProblem([], []);
    const result = solveLineup(problem);
    const plan = planFrom(result);

    expect(plan.assignments).toEqual([]);
    expect(plan.totalSelectionValue).toBe(0);
    expect(plan.requiredStartingPositions).toBe(0);
    expect(isLegalPlan(problem, plan)).toBe(true);
  });

  it("handles a roster with no starting positions", () => {
    const problem = lineupProblem([benchSlot("BN", 2)], [player("a", 10), player("b", -2)]);

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("a", "BN"), assignment("b", "BN")]);
    expect(plan.totalSelectionValue).toBe(0);
    expect(plan.filledStartingPositions).toBe(0);
  });

  it("is deterministic and independent of input order", () => {
    const problem = lineupProblem(
      [
        startingSlot("QB", 1, "required", ["QB"]),
        startingSlot("RB", 1, "required", ["RB"]),
        benchSlot("BN", 2),
      ],
      [player("qb", 10, { positions: ["QB"] }), player("rb", 10, { positions: ["RB"] })],
    );
    const reordered = lineupProblem([...problem.slots].reverse(), [...problem.players].reverse());

    const first = planFrom(solveLineup(problem));
    const second = planFrom(solveLineup(problem));
    const third = planFrom(solveLineup(reordered));

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("returns the same assignment when its own result becomes current", () => {
    const problem = lineupProblem(
      [
        startingSlot("S1", 1, "optional", ["A"]),
        startingSlot("S2", 1, "optional", ["A"]),
        benchSlot("BN", 1),
      ],
      [
        player("a", 10, { positions: ["A"] }),
        player("b", 10, { positions: ["A"] }),
        player("c", 0, { positions: ["A"] }),
      ],
    );
    const first = planFrom(solveLineup(problem));
    const currentById = new Map(first.assignments.map((item) => [item.playerId, item.slotId]));
    const repeated = lineupProblem(
      problem.slots,
      problem.players.map((item) => ({
        ...item,
        currentSlotId: currentById.get(item.id) ?? item.currentSlotId,
      })),
    );

    const second = planFrom(solveLineup(repeated));

    expect(second.assignments).toEqual(first.assignments);
    expect(second.comparison.slotChanges).toEqual([]);
  });

  it("terminates on realistic roster and slot sizes", () => {
    const small = generatedProblem(30, 20);
    const large = generatedProblem(60, 40);

    expect(planFrom(solveLineup(small)).assignments).toHaveLength(30);
    expect(planFrom(solveLineup(large)).assignments).toHaveLength(60);
  });
});

describe("availability tiers", () => {
  it("starts an available player ahead of a higher-valued unavailable player", () => {
    const problem = lineupProblem(
      [startingSlot("RB", 1, "required", ["RB"]), benchSlot("BN", 1)],
      [
        player("healthy", 10, { positions: ["RB"] }),
        player("injured", 100, { positions: ["RB"], availabilityTier: willNotPlay }),
      ],
      tiers,
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("healthy", "RB"), assignment("injured", "BN")]);
    expect(plan.totalSelectionValue).toBe(10);
  });

  it("starts an available zero ahead of a higher-valued doubtful player", () => {
    const problem = lineupProblem(
      [startingSlot("RB", 1, "required", ["RB"]), benchSlot("BN", 1)],
      [
        player("healthy", 0, { positions: ["RB"] }),
        player("doubtful", 100, { positions: ["RB"], availabilityTier: mightPlay }),
      ],
      tiers,
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("doubtful", "BN"), assignment("healthy", "RB")]);
    expect(plan.totalSelectionValue).toBe(0);
  });

  it("starts an available zero ahead of a higher-valued unavailable player", () => {
    const problem = lineupProblem(
      [startingSlot("RB", 1, "required", ["RB"]), benchSlot("BN", 1)],
      [
        player("healthy", 0, { positions: ["RB"] }),
        player("injured", 100, { positions: ["RB"], availabilityTier: willNotPlay }),
      ],
      tiers,
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("healthy", "RB"), assignment("injured", "BN")]);
    expect(plan.totalSelectionValue).toBe(0);
  });

  it("starts a doubtful player ahead of a higher-valued unavailable player", () => {
    const problem = lineupProblem(
      [startingSlot("RB", 1, "required", ["RB"]), benchSlot("BN", 1)],
      [
        player("doubtful", 0, { positions: ["RB"], availabilityTier: mightPlay }),
        player("out", 100, { positions: ["RB"], availabilityTier: willNotPlay }),
      ],
      tiers,
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("doubtful", "RB"), assignment("out", "BN")]);
    expect(plan.totalSelectionValue).toBe(0);
  });

  it("fills a vacant starting position with an unavailable player", () => {
    const problem = lineupProblem(
      [startingSlot("RB", 1, "optional", ["RB"]), benchSlot("BN", 1)],
      [player("injured", 12, { positions: ["RB"], availabilityTier: willNotPlay })],
      tiers,
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("injured", "RB")]);
    expect(plan.filledStartingPositions).toBe(1);
    expect(plan.totalSelectionValue).toBe(12);
  });

  it("competes unavailable players against each other by value", () => {
    const problem = lineupProblem(
      [startingSlot("RB", 1, "required", ["RB"]), benchSlot("BN", 1)],
      [
        player("worse", 4, { positions: ["RB"], availabilityTier: willNotPlay }),
        player("better", 99, { positions: ["RB"], availabilityTier: willNotPlay }),
      ],
      tiers,
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("better", "RB"), assignment("worse", "BN")]);
    expect(plan.totalSelectionValue).toBe(99);
  });

  it("seats an unavailable player in a vacant position rather than an available player costing points", () => {
    const problem = lineupProblem(
      [startingSlot("RB", 1, "optional", ["RB"]), benchSlot("BN", 2)],
      [
        player("costly", -5, { positions: ["RB"] }),
        player("injured", 10, { positions: ["RB"], availabilityTier: willNotPlay }),
      ],
      tiers,
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("costly", "BN"), assignment("injured", "RB")]);
    expect(plan.totalSelectionValue).toBe(10);
  });
});

describe("problem contract", () => {
  it("rejects a player whose availability tier is not declared", () => {
    const problem = lineupProblem(
      [benchSlot("BN", 1)],
      [player("a", 1, { availabilityTier: makeAvailabilityTier("undeclared") })],
    );

    expect(() => solveLineup(problem)).toThrow(/undeclared availability tier/u);
  });

  it("rejects a duplicate availability tier", () => {
    const problem = lineupProblem([benchSlot("BN", 1)], [player("a", 1)], [willPlay, willPlay]);

    expect(() => solveLineup(problem)).toThrow(/Duplicate availability tier/u);
  });

  it("rejects a problem without an availability tier", () => {
    const problem = lineupProblem([benchSlot("BN", 1)], [player("a", 1)], []);

    expect(() => solveLineup(problem)).toThrow(/at least one availability tier/u);
  });
});

describe("lineup refusals", () => {
  it("refuses a roster larger than the available slot capacity", () => {
    const refusal = refusalFrom(
      solveLineup(lineupProblem([benchSlot("BN", 1)], [player("a", 1), player("b", 2)])),
    );

    expect(refusal).toEqual({
      reason: "roster-exceeds-slot-capacity",
      playerCount: 2,
      slotCapacity: 1,
    });
  });

  it("refuses a lock that references an unknown slot", () => {
    const refusal = refusalFrom(
      solveLineup(
        lineupProblem([benchSlot("BN", 1)], [player("a", 1, { lockedSlotId: slotId("GHOST") })]),
      ),
    );

    expect(refusal).toEqual({
      reason: "lock-references-unknown-slot",
      playerId: playerId("a"),
      slotId: slotId("GHOST"),
    });
  });

  it("refuses a locked player who is ineligible for the locked slot", () => {
    const refusal = refusalFrom(
      solveLineup(
        lineupProblem(
          [startingSlot("QB", 1, "required", ["QB"]), benchSlot("BN", 1)],
          [
            player("receiver", 1, {
              positions: ["WR"],
              lockedSlotId: slotId("QB"),
            }),
          ],
        ),
      ),
    );

    expect(refusal).toEqual({
      reason: "locked-player-ineligible-for-slot",
      playerId: playerId("receiver"),
      slotId: slotId("QB"),
    });
  });

  it("refuses more locks on a slot than its capacity", () => {
    const refusal = refusalFrom(
      solveLineup(
        lineupProblem(
          [benchSlot("BN", 1)],
          [
            player("a", 1, { lockedSlotId: slotId("BN") }),
            player("b", 2, { lockedSlotId: slotId("BN") }),
          ],
        ),
      ),
    );

    expect(refusal).toEqual({
      reason: "lock-capacity-exceeded",
      slotId: slotId("BN"),
      capacity: 1,
      playerIds: [playerId("a"), playerId("b")],
    });
  });

  it("refuses a player with no legal slot", () => {
    const refusal = refusalFrom(
      solveLineup(
        lineupProblem(
          [
            startingSlot("QB", 1, "required", ["QB"]),
            benchSlot("BN", 1, { kind: "positions", positions: ["QB"] }),
          ],
          [
            player("quarterback", 1, { positions: ["QB"] }),
            player("receiver", 2, { positions: ["WR"] }),
          ],
        ),
      ),
    );

    expect(refusal).toEqual({
      reason: "player-has-no-legal-slot",
      playerIds: [playerId("receiver")],
    });
  });

  it("refuses an unfillable required starting position", () => {
    const refusal = refusalFrom(
      solveLineup(
        lineupProblem(
          [startingSlot("QB", 1, "required", ["QB"]), benchSlot("BN", 1)],
          [player("receiver", 1, { positions: ["WR"] })],
        ),
      ),
    );

    expect(refusal).toEqual({
      reason: "required-starting-position-unfillable",
      slotId: slotId("QB"),
      capacity: 1,
      lockedPlayers: 0,
      availablePlayerCount: 0,
    });
  });

  it("refuses when too few eligible players remain for a required position", () => {
    const refusal = refusalFrom(
      solveLineup(
        lineupProblem(
          [startingSlot("RB", 2, "required", ["RB"]), benchSlot("BN", 2)],
          [
            player("running-back", 1, { positions: ["RB"] }),
            player("receiver", 2, { positions: ["WR"] }),
          ],
        ),
      ),
    );

    expect(refusal).toEqual({
      reason: "required-starting-position-unfillable",
      slotId: slotId("RB"),
      capacity: 2,
      lockedPlayers: 0,
      availablePlayerCount: 1,
    });
  });

  it("refuses when required positions compete for the same single player", () => {
    const refusal = refusalFrom(
      solveLineup(
        lineupProblem(
          [
            startingSlot("RB", 1, "required", ["RB"]),
            startingSlot("FLEX", 1, "required", ["RB", "WR"]),
          ],
          [player("only", 1, { positions: ["RB"] })],
        ),
      ),
    );

    expect(refusal.reason).toBe("required-starting-position-unfillable");
    if (refusal.reason === "required-starting-position-unfillable") {
      expect([slotId("RB"), slotId("FLEX")]).toContain(refusal.slotId);
    }
  });

  it("refuses an unusable selection value that has no bench or reserve slot", () => {
    const refusal = refusalFrom(
      solveLineup(
        lineupProblem(
          [startingSlot("FLEX", 1, "optional", ["RB"])],
          [
            player("missing", 0, {
              positions: ["RB"],
              selection: unusableSelection(basis, "missing"),
            }),
          ],
        ),
      ),
    );

    expect(refusal).toEqual({
      reason: "unusable-selection-value",
      playerIds: [playerId("missing")],
    });
  });

  it("benches an unusable selection value that can start", () => {
    const problem = lineupProblem(
      [startingSlot("FLEX", 1, "optional", ["RB"]), benchSlot("BN", 1)],
      [
        player("starter", 1, { positions: ["RB"] }),
        player("missing", 0, {
          positions: ["RB"],
          selection: unusableSelection(basis, "missing"),
        }),
      ],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([assignment("missing", "BN"), assignment("starter", "FLEX")]);
  });

  it("allows an unusable selection value for a player who cannot legally start", () => {
    const problem = lineupProblem(
      [startingSlot("QB", 1, "required", ["QB"]), benchSlot("BN", 1)],
      [
        player("quarterback", 1, { positions: ["QB"] }),
        player("missing", 0, {
          positions: ["WR"],
          selection: unusableSelection(basis, "missing"),
        }),
      ],
    );

    const plan = planFrom(solveLineup(problem));

    expect(plan.assignments).toEqual([
      assignment("missing", "BN"),
      assignment("quarterback", "QB"),
    ]);
    expect(plan.totalSelectionValue).toBe(1);
  });

  it("refuses a reserve-ineligible player with no bench destination", () => {
    const refusal = refusalFrom(
      solveLineup(
        lineupProblem(
          [reserveSlot("IR", 1)],
          [player("ineligible", 1, { reserveEligible: false })],
        ),
      ),
    );

    expect(refusal).toEqual({
      reason: "player-has-no-legal-slot",
      playerIds: [playerId("ineligible")],
    });
  });
});

function lineupProblem(
  slots: ReadonlyArray<RosterSlot>,
  players: ReadonlyArray<RosterPlayer>,
  availabilityTiers: ReadonlyArray<AvailabilityTier> = [willPlay],
): LineupProblem {
  return { selectionBasis: basis, availabilityTiers, slots, players };
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

function benchSlot(
  id: string,
  capacity: number,
  eligibility: SlotEligibility = { kind: "any" },
): BenchSlot {
  return { kind: "bench", id: slotId(id), capacity, eligibility };
}

function reserveSlot(id: string, capacity: number): RosterSlot {
  return { kind: "reserve", id: slotId(id), capacity, eligibility: { kind: "any" } };
}

function player(
  id: string,
  units: number,
  options: {
    readonly positions?: ReadonlyArray<string>;
    readonly availabilityTier?: AvailabilityTier;
    readonly selection?: PlayerSelection;
    readonly reserveEligible?: boolean;
    readonly lockedSlotId?: SlotId;
    readonly currentSlotId?: SlotId;
  } = {},
): RosterPlayer {
  return {
    id: playerId(id),
    eligiblePositions: options.positions ?? ["A", "B", "C"],
    availabilityTier: options.availabilityTier ?? willPlay,
    selection: options.selection ?? knownSelection(basis, units),
    reserveEligible: options.reserveEligible ?? false,
    lockedSlotId: options.lockedSlotId,
    currentSlotId: options.currentSlotId,
  };
}

function assignment(player: string, slot: string): LineupAssignment {
  return { playerId: playerId(player), slotId: slotId(slot) };
}

function planFrom(result: LineupSolveResult): LineupPlan {
  if (result.kind !== "plan") {
    throw new Error(`Expected a plan but received ${result.refusal.reason}.`);
  }
  return result.plan;
}

function refusalFrom(result: LineupSolveResult): LineupRefusal {
  if (result.kind !== "refusal") {
    throw new Error("Expected a refusal but received a plan.");
  }
  return result.refusal;
}

function generatedProblem(playerCount: number, slotCount: number): LineupProblem {
  const slots: Array<RosterSlot> = [];
  const players: Array<RosterPlayer> = [];
  const startingCount = Math.ceil(slotCount / 2);

  for (let index = 0; index < slotCount; index += 1) {
    slots.push(
      index < startingCount
        ? startingSlot(`S${index}`, 2, "required", ["A", "B"])
        : benchSlot(`B${index}`, 2),
    );
  }
  for (let index = 0; index < playerCount; index += 1) {
    players.push(player(`P${index}`, (index % 21) - 10, { positions: ["A", "B"] }));
  }

  return lineupProblem(slots, players);
}

function playerId(value: string): PlayerId {
  return makePlayerId(value);
}

function slotId(value: string): SlotId {
  return makeSlotId(value);
}
