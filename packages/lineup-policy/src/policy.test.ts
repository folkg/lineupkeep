import { parseExact, scoringProfile } from "@lineupkeep/lineup-scoring";
import {
  isLegalPlan,
  isStartingSlot,
  makePlayerId,
  makeSlotId,
  solveLineup,
} from "@lineupkeep/lineup-solver";
import type {
  BenchSlot,
  LineupPlan,
  LineupProblem,
  LineupSolveResult,
  ReserveSlot,
  RosterSlot,
  StartingSlot,
} from "@lineupkeep/lineup-solver";
import { describe, expect, it } from "vitest";

import { periodKey } from "./period.ts";
import { buildLineupProblem } from "./policy.ts";
import {
  percentStartedPopulation,
  preferredValueSource,
  startCutPreference,
  valueSourceLadder,
} from "./source.ts";
import type {
  LineupPolicyInput,
  LineupPolicyResult,
  PercentStartedCut,
  Period,
  PeriodObservation,
  PlayerAvailability,
  PlayerPercentStarted,
  PlayerValuation,
  PolicyPlayer,
  ValueSource,
} from "./types.ts";

const target: Period = { kind: "week", week: 7 };
const unitRule = scoringProfile({ categories: [], rules: [{ statId: 1, points: "0.01" }] });

describe("availability", () => {
  it("values an available player by the mean of the counted completed periods", () => {
    const input = availabilityInput({
      weeks: [1000, 2000, 2000, 3001],
      availability: { kind: "available" },
    });

    const valuation = valuationFrom(buildLineupProblem(input), "p1");
    const realised = realisedValue(valuation);

    expect(realised.countedPeriods.map(periodKey)).toEqual([
      "week:3",
      "week:4",
      "week:5",
      "week:6",
    ]);
    expect(realised.average).toEqual(parseExact("20"));
    expect(knownUnits(valuation)).toBe(2000);
    expect(valuation.availability).toEqual({ tier: "will-play", fact: "available" });
  });

  it("keeps a player's value when they have no game in the target period", () => {
    const input = availabilityInput({
      weeks: [1600, 1600, 1600, 1600],
      availability: { kind: "available" },
      nonGamePeriods: [target],
    });

    const valuation = valuationFrom(buildLineupProblem(input), "p1");

    expect(valuation.availability).toEqual({
      tier: "will-not-play",
      fact: "no-game",
      period: target,
    });
    expect(realisedValue(valuation).average).toEqual(parseExact("16"));
    expect(knownUnits(valuation)).toBe(1600);
  });

  it("keeps an excluded player's value while marking them as not playing", () => {
    const input = availabilityInput({
      weeks: [2000, 2000, 2000, 2000],
      availability: { kind: "excluded", reason: "injured-reserve" },
    });

    const valuation = valuationFrom(buildLineupProblem(input), "p1");

    expect(valuation.availability).toEqual({
      tier: "will-not-play",
      fact: "excluded",
      reason: "injured-reserve",
    });
    expect(realisedValue(valuation).average).toEqual(parseExact("20"));
    expect(knownUnits(valuation)).toBe(2000);
  });

  it("values a player identically whether they are healthy, doubtful, excluded, or unrecognised", () => {
    const availabilities: ReadonlyArray<PlayerAvailability> = [
      { kind: "available" },
      { kind: "uncertain", reason: "day-to-day" },
      { kind: "excluded", reason: "out" },
      { kind: "unrecognised", code: "PROBABLE" },
    ];
    const observed = availabilities.map((availability) => {
      const valuation = valuationFrom(
        buildLineupProblem(availabilityInput({ weeks: [1000, 1000, 1000, 1000], availability })),
        "p1",
      );
      return { units: knownUnits(valuation), tier: valuation.availability.tier };
    });

    expect(observed).toEqual([
      { units: 1000, tier: "will-play" },
      { units: 1000, tier: "might-play" },
      { units: 1000, tier: "will-not-play" },
      { units: 1000, tier: "might-play" },
    ]);
  });

  it("plans a lineup for an unrecognised status instead of refusing the run", () => {
    const result = buildLineupProblem(
      rosterInput({
        players: [
          {
            id: "p1",
            weeks: [3000, 3000, 3000, 3000],
            availability: { kind: "unrecognised", code: "PROBABLE" },
            slot: "QB",
            positions: ["QB"],
          },
          { id: "p2", weeks: [1000, 1000, 1000, 1000], positions: ["QB"] },
        ],
      }),
    );

    const valuation = valuationFrom(result, "p1");
    const plan = planFrom(solveLineup(problemFrom(result)));

    expect(valuation.availability).toEqual({
      tier: "might-play",
      fact: "unrecognised-status",
      code: "PROBABLE",
    });
    expect(knownUnits(valuation)).toBe(3000);
    expect(plan.assignments).toContainEqual({
      playerId: makePlayerId("p1"),
      slotId: makeSlotId("BN"),
    });
  });

  it("values a player with no counted period at zero and records the unmeasured periods", () => {
    const result = buildLineupProblem(
      rosterInput({
        players: [{ id: "p1", weeks: [null, null, null, null], slot: "QB", positions: ["QB"] }],
      }),
    );

    const valuation = valuationFrom(result, "p1");
    const realised = realisedValue(valuation);

    expect(realised.average).toBeUndefined();
    expect(knownUnits(valuation)).toBe(0);
    expect(realised.skippedPeriods.map(periodKey)).toEqual([
      "week:3",
      "week:4",
      "week:5",
      "week:6",
    ]);
    expect(solveLineup(problemFrom(result)).kind).toBe("plan");
  });

  it("skips a published non-game period from the mean instead of scoring it zero", () => {
    const input = availabilityInput({
      weeks: [1000, 1000, 0, 1000],
      availability: { kind: "available" },
      nonGamePeriods: [{ kind: "week", week: 5 }],
    });

    const valuation = valuationFrom(buildLineupProblem(input), "p1");
    const realised = realisedValue(valuation);

    expect(realised.countedPeriods.map(periodKey)).toEqual(["week:3", "week:4", "week:6"]);
    expect(realised.skippedPeriods.map(periodKey)).toEqual(["week:5"]);
    expect(knownUnits(valuation)).toBe(1000);
  });

  it("skips a period whose scored value is unknown", () => {
    const input = availabilityInput({
      weeks: [1000, null, 1000, 1000],
      availability: { kind: "available" },
    });

    const valuation = valuationFrom(buildLineupProblem(input), "p1");

    expect(realisedValue(valuation).countedPeriods.map(periodKey)).toEqual([
      "week:3",
      "week:5",
      "week:6",
    ]);
    expect(knownUnits(valuation)).toBe(1000);
  });

  it("starts a healthy player ahead of a higher-valued injured player", () => {
    const result = buildLineupProblem(
      rosterInput({
        players: [
          {
            id: "injured",
            weeks: [5000, 5000, 5000, 5000],
            availability: { kind: "excluded", reason: "out" },

            positions: ["QB"],
          },
          { id: "healthy", weeks: [1000, 1000, 1000, 1000], positions: ["QB"] },
        ],
      }),
    );

    const plan = planFrom(solveLineup(problemFrom(result)));

    expect(plan.assignments).toEqual([
      { playerId: makePlayerId("healthy"), slotId: makeSlotId("QB") },
      { playerId: makePlayerId("injured"), slotId: makeSlotId("BN") },
    ]);
    expect(plan.totalSelectionValue).toBe(1000);
  });

  it("starts an injured player in a starting position that would otherwise stay empty", () => {
    const result = buildLineupProblem(
      rosterInput({
        players: [
          {
            id: "injured",
            weeks: [4200, 4200, 4200, 4200],
            availability: { kind: "excluded", reason: "out" },
            positions: ["QB"],
          },
        ],
      }),
    );

    const plan = planFrom(solveLineup(problemFrom(result)));

    expect(plan.assignments).toEqual([
      { playerId: makePlayerId("injured"), slotId: makeSlotId("QB") },
    ]);
  });

  it("starts an available player worth nothing ahead of an injured player who scored well", () => {
    const result = buildLineupProblem(
      rosterInput({
        players: [
          {
            id: "injured",
            weeks: [4000, 4000, 4000, 4000],
            availability: { kind: "excluded", reason: "suspended" },
            positions: ["QB"],
          },
          { id: "healthy", weeks: [0, 0, 0, 0], positions: ["QB"] },
        ],
      }),
    );

    const plan = planFrom(solveLineup(problemFrom(result)));

    expect(plan.assignments).toEqual([
      { playerId: makePlayerId("healthy"), slotId: makeSlotId("QB") },
      { playerId: makePlayerId("injured"), slotId: makeSlotId("BN") },
    ]);
    expect(plan.totalSelectionValue).toBe(0);
  });
});

describe("value sources", () => {
  it("orders the ladder from projections to rules to started percentages", () => {
    expect(valueSourceLadder).toEqual(["projected-points", "scoring-rules", "percent-started"]);
    expect(startCutPreference).toEqual(["diamond"]);
  });

  it("treats a published cut as a population only when it carries a value", () => {
    expect(
      percentStartedPopulation([{ id: makePlayerId("p1"), percent: undefined, cuts: [] }]),
    ).toEqual({ kind: "overall" });
    expect(
      percentStartedPopulation([
        {
          id: makePlayerId("p1"),
          percent: parseExact("40"),
          cuts: [{ cut: "diamond", percent: parseExact("0") }],
        },
      ]),
    ).toEqual({ kind: "overall" });
    expect(
      percentStartedPopulation([
        {
          id: makePlayerId("p1"),
          percent: parseExact("40"),
          cuts: [{ cut: "diamond", percent: parseExact("7") }],
        },
      ]),
    ).toEqual({ kind: "cut", cut: "diamond" });
  });

  it("prefers projected points over league rules over a started percentage", () => {
    expect(preferredValueSource(["percent-started", "scoring-rules", "projected-points"])).toBe(
      "projected-points",
    );
    expect(preferredValueSource(["percent-started", "scoring-rules"])).toBe("scoring-rules");
    expect(preferredValueSource(["percent-started"])).toBe("percent-started");
    expect(preferredValueSource([])).toBeUndefined();
  });

  it("names the realised mean basis and gives it to every player", () => {
    const result = buildLineupProblem(
      rosterInput({
        players: [
          { id: "p1", weeks: [1000, 1000, 1000, 1000], positions: ["QB"] },
          { id: "p2", weeks: [2000, 2000, 2000, 2000], positions: ["QB"] },
        ],
      }),
    );

    expect(problemFrom(result).selectionBasis).toBe(
      "mean-points-per-period:week:3,week:4,week:5,week:6",
    );
    expect(selectionBases(result)).toEqual([
      "mean-points-per-period:week:3,week:4,week:5,week:6",
      "mean-points-per-period:week:3,week:4,week:5,week:6",
    ]);
  });

  it("uses a projection as the value and records the realised total without adding it", () => {
    const result = buildLineupProblem(
      inputFor({
        source: {
          kind: "projected-points",
          projections: [{ id: makePlayerId("p1"), points: parseExact("18.25") }],
          realised: [{ id: makePlayerId("p1"), points: parseExact("31.4") }],
        },
        players: [{ id: "p1", slot: "QB", positions: ["QB"] }],
      }),
    );

    const valuation = valuationFrom(result, "p1");

    expect(valuation.value).toEqual({
      kind: "projected-points",
      projection: parseExact("18.25"),
      realised: parseExact("31.4"),
    });
    expect(knownUnits(valuation)).toBe(1825);
    expect(problemFrom(result).selectionBasis).toBe("projected-points:week:7");
  });

  it("cannot value a player without a projection from that player's realised statistics", () => {
    const result = buildLineupProblem(
      inputFor({
        source: {
          kind: "projected-points",
          projections: [],
          realised: [{ id: makePlayerId("p1"), points: parseExact("31.4") }],
        },
        players: [{ id: "p1", slot: "QB", positions: ["QB"] }],
      }),
    );

    const valuation = valuationFrom(result, "p1");

    expect(valuation.selection).toEqual({
      kind: "unusable",
      basis: "projected-points:week:7",
      reason: "missing",
    });
    expect(solveLineup(problemFrom(result))).toEqual({
      kind: "refusal",
      refusal: { reason: "unusable-selection-value", playerIds: [makePlayerId("p1")] },
    });
  });

  it("values a started percentage in hundredths of a percent and applies availability", () => {
    const result = buildLineupProblem(
      inputFor({
        source: startedSource([{ id: "p1", percent: 43, cuts: [] }]),
        players: [{ id: "p1", slot: "QB", positions: ["QB"] }],
      }),
    );

    const valuation = valuationFrom(result, "p1");

    expect(valuation.value).toEqual({
      kind: "percent-started",
      population: { kind: "overall" },
      percent: parseExact("43"),
    });
    expect(knownUnits(valuation)).toBe(4300);
    expect(valuation.availability.tier).toBe("will-play");
    expect(problemFrom(result).selectionBasis).toBe("percent-started:overall:week:7");
  });

  it("prefers a populated diamond cut over the overall percentage", () => {
    const result = buildLineupProblem(
      inputFor({
        source: startedSource([
          { id: "p1", percent: 43, cuts: [{ cut: "diamond", percent: 51 }] },
          { id: "p2", percent: 80, cuts: [{ cut: "diamond", percent: 12 }] },
        ]),
        players: [
          { id: "p1", slot: "BN", positions: ["QB"] },
          { id: "p2", slot: "QB", positions: ["QB"] },
        ],
      }),
    );

    expect(problemFrom(result).selectionBasis).toBe("percent-started:cut-diamond:week:7");
    expect(unitsByPlayer(result)).toEqual({ p1: 5100, p2: 1200 });
    expect(valuationFrom(result, "p1").value).toEqual({
      kind: "percent-started",
      population: { kind: "cut", cut: "diamond" },
      percent: parseExact("51"),
    });
  });

  it("falls back to the overall percentage when the diamond cut is published but empty", () => {
    const result = buildLineupProblem(
      inputFor({
        source: startedSource([
          { id: "p1", percent: 43, cuts: [{ cut: "diamond", percent: 0 }] },
          { id: "p2", percent: 80, cuts: [{ cut: "diamond", percent: 0 }] },
        ]),
        players: [
          { id: "p1", slot: "BN", positions: ["QB"] },
          { id: "p2", slot: "QB", positions: ["QB"] },
        ],
      }),
    );

    expect(problemFrom(result).selectionBasis).toBe("percent-started:overall:week:7");
    expect(unitsByPlayer(result)).toEqual({ p1: 4300, p2: 8000 });
  });

  it("keeps a zero started percentage as a real value", () => {
    const result = buildLineupProblem(
      inputFor({
        source: startedSource([{ id: "p1", percent: 0, cuts: [] }]),
        players: [{ id: "p1", slot: "BN", positions: ["QB"] }],
      }),
    );

    expect(valuationFrom(result, "p1").selection).toEqual({
      kind: "known",
      basis: "percent-started:overall:week:7",
      units: 0,
    });
  });

  it("refuses to plan when a player has no started percentage", () => {
    const result = buildLineupProblem(
      inputFor({
        source: startedSource([{ id: "p1", percent: undefined, cuts: [] }]),
        players: [{ id: "p1", slot: "QB", positions: ["QB"] }],
      }),
    );

    expect(valuationFrom(result, "p1").selection).toEqual({
      kind: "unusable",
      basis: "percent-started:overall:week:7",
      reason: "missing",
    });
    expect(solveLineup(problemFrom(result))).toEqual({
      kind: "refusal",
      refusal: { reason: "unusable-selection-value", playerIds: [makePlayerId("p1")] },
    });
  });

  it("starts a healthy player with a lower started percentage ahead of an excluded one", () => {
    const result = buildLineupProblem(
      inputFor({
        source: startedSource([
          { id: "excluded", percent: 91, cuts: [] },
          { id: "healthy", percent: 12, cuts: [] },
        ]),
        players: [
          {
            id: "excluded",
            slot: "BN",
            positions: ["QB"],
            availability: { kind: "excluded", reason: "out" },
          },
          { id: "healthy", slot: "BN", positions: ["QB"] },
        ],
      }),
    );

    const plan = planFrom(solveLineup(problemFrom(result)));

    expect(plan.assignments).toContainEqual({
      playerId: makePlayerId("healthy"),
      slotId: makeSlotId("QB"),
    });
    expect(plan.assignments).toContainEqual({
      playerId: makePlayerId("excluded"),
      slotId: makeSlotId("BN"),
    });
  });
});

describe("policy contract", () => {
  it("refuses a league that publishes no value source", () => {
    const result = buildLineupProblem({
      period: target,
      source: undefined,
      slots: footballSlots(),
      players: [policyPlayer({ id: "p1" })],
    });

    expect(result).toEqual({ kind: "refusal", refusal: { kind: "no-value-source" } });
  });

  it("refuses when no completed period was observed", () => {
    const result = buildLineupProblem({
      period: target,
      source: {
        kind: "scoring-rules",
        window: [],
        scoring: unitRule,
        observations: [],
      },
      slots: footballSlots(),
      players: [policyPlayer({ id: "p1" })],
    });

    expect(result).toEqual({
      kind: "refusal",
      refusal: { kind: "no-observed-periods", window: [] },
    });
  });

  it("rejects observations from outside the declared window", () => {
    const input = availabilityInput({ weeks: [1000, 1000, 1000, 1000] });

    expect(() =>
      buildLineupProblem({
        ...input,
        source: {
          ...rulesSource([{ id: "p1", weeks: [1000, 1000, 1000, 1000] }]),
          observations: [
            ...observationsFor([{ id: "p1", weeks: [1000, 1000, 1000, 1000] }]),
            { period: week(2), players: [{ id: makePlayerId("p1"), stats: [] }] },
          ],
        },
      }),
    ).toThrow(/outside the declared window/u);
  });

  it("rejects a window that contains its own target period", () => {
    const input = availabilityInput({ weeks: [1000, 1000, 1000, 1000] });

    expect(() =>
      buildLineupProblem({
        ...input,
        source: {
          ...rulesSource([{ id: "p1", weeks: [1000, 1000, 1000, 1000] }]),
          window: [{ kind: "week", week: 7 }],
        },
      }),
    ).toThrow(/cannot belong to its own observation window/u);
  });

  it("rejects an observation for a player who is not on the roster", () => {
    const input = availabilityInput({ weeks: [1000, 1000, 1000, 1000] });

    expect(() =>
      buildLineupProblem({
        ...input,
        source: {
          ...rulesSource([{ id: "p1", weeks: [1000, 1000, 1000, 1000] }]),
          observations: [{ period: week(3), players: [{ id: makePlayerId("other"), stats: [] }] }],
        },
      }),
    ).toThrow(/not on the policy roster/u);
  });

  it("rejects a source that lists the same player twice", () => {
    const source = startedSource([
      { id: "p1", percent: 10, cuts: [] },
      { id: "p1", percent: 20, cuts: [] },
    ]);

    expect(() =>
      buildLineupProblem(
        inputFor({ source, players: [{ id: "p1", slot: "BN", positions: ["QB"] }] }),
      ),
    ).toThrow(/Duplicate started percentage for player/u);
  });

  it("derives reserve eligibility from the declared reserve slots", () => {
    const input = availabilityInput({ weeks: [1000, 1000, 1000, 1000], positions: ["QB", "IR"] });
    const problem = problemFrom(buildLineupProblem(input));
    const player = problem.players.find((candidate) => candidate.id === makePlayerId("p1"));

    expect(player?.reserveEligible).toBe(true);
    expect(
      problem.players.find((candidate) => candidate.id === makePlayerId("p2"))?.reserveEligible,
    ).toBe(false);
  });
});

describe("worked example: recorded football league", () => {
  it("keeps the recorded lineup when the provider locks the players who could improve it", () => {
    const result = buildLineupProblem(recordedFootballInput(true));
    const plan = planFrom(solveLineup(problemFrom(result)));

    expect(plan.totalSelectionValue).toBe(11441);
    expect(plan.comparison.slotChanges).toEqual([]);
    expect(isLegalPlan(problemFrom(result), plan)).toBe(true);
    expect(unitsByPlayer(result)).toEqual(recordedUnits);
  });

  it("starts the better running back when the same roster is editable", () => {
    const result = buildLineupProblem(recordedFootballInput(false));
    const plan = planFrom(solveLineup(problemFrom(result)));

    expect(plan.totalSelectionValue).toBe(12176);
    expect(plan.comparison.addedStarters).toEqual([makePlayerId("BN-12")]);
    expect(plan.comparison.removedStarters).toEqual([makePlayerId("RB-3")]);
    expect([...startingPlayerIds(plan)].sort()).toEqual([
      "BN-12",
      "DEF-15",
      "K-14",
      "QB-1",
      "RB-2",
      "TE-6",
      "W/R/T-7",
      "WR-4",
      "WR-5",
    ]);
  });

  it("marks the two editable players on bye as not playing while keeping their means", () => {
    const result = buildLineupProblem(recordedFootballInput(true));

    expect(valuationFrom(result, "BN-8").availability).toEqual({
      tier: "will-not-play",
      fact: "no-game",
      period: target,
    });
    expect(realisedValue(valuationFrom(result, "BN-8")).average).toEqual(parseExact("16.1"));
    expect(unitsByPlayer(result)["BN-8"]).toBe(1610);
    expect(valuationFrom(result, "BN-13").availability.tier).toBe("will-not-play");
    expect(unitsByPlayer(result)["BN-13"]).toBe(980);
  });
});

const recordedUnits: Readonly<Record<string, number>> = {
  "QB-1": 2167,
  "RB-2": 1308,
  "RB-3": 398,
  "WR-4": 1850,
  "WR-5": 1985,
  "TE-6": 978,
  "W/R/T-7": 1555,
  "BN-8": 1610,
  "BN-9": 977,
  "BN-10": 568,
  "BN-11": 0,
  "BN-12": 1133,
  "BN-13": 980,
  "K-14": 800,
  "DEF-15": 400,
};

type RecordedPlayer = {
  readonly id: string;
  readonly slot: string;
  readonly positions: ReadonlyArray<string>;
  readonly byeWeek: number;
  readonly availability: PlayerAvailability;
  readonly locked: boolean;
  readonly weeks: ReadonlyArray<number | null>;
};

const available: PlayerAvailability = { kind: "available" };
const injuredReserve: PlayerAvailability = { kind: "excluded", reason: "injured-reserve" };

const recordedRoster: ReadonlyArray<RecordedPlayer> = [
  {
    id: "QB-1",
    slot: "QB",
    positions: ["QB"],
    byeWeek: 9,
    availability: available,
    locked: true,
    weeks: [2368, 2396, 2200, 1702],
  },
  {
    id: "RB-2",
    slot: "RB",
    positions: ["RB"],
    byeWeek: 10,
    availability: available,
    locked: true,
    weeks: [780, 610, 3150, 690],
  },
  {
    id: "RB-3",
    slot: "RB",
    positions: ["RB"],
    byeWeek: 11,
    availability: available,
    locked: true,
    weeks: [390, 420, 480, 300],
  },
  {
    id: "WR-4",
    slot: "WR",
    positions: ["WR"],
    byeWeek: 11,
    availability: available,
    locked: true,
    weeks: [2840, 1460, 1880, 1220],
  },
  {
    id: "WR-5",
    slot: "WR",
    positions: ["WR"],
    byeWeek: 11,
    availability: available,
    locked: true,
    weeks: [0, 2770, 3770, 1400],
  },
  {
    id: "TE-6",
    slot: "TE",
    positions: ["TE"],
    byeWeek: 11,
    availability: available,
    locked: true,
    weeks: [2410, 1170, 140, 190],
  },
  {
    id: "W/R/T-7",
    slot: "W/R/T",
    positions: ["W/R/T"],
    byeWeek: 8,
    availability: available,
    locked: true,
    weeks: [1970, 1960, 860, 1430],
  },
  {
    id: "BN-8",
    slot: "BN",
    positions: ["RB", "W/R/T"],
    byeWeek: 7,
    availability: available,
    locked: true,
    weeks: [1700, 1110, 1160, 2470],
  },
  {
    id: "BN-9",
    slot: "BN",
    positions: ["RB", "W/R/T"],
    byeWeek: 5,
    availability: available,
    locked: true,
    weeks: [400, 1100, null, 1430],
  },
  {
    id: "BN-10",
    slot: "BN",
    positions: ["RB", "W/R/T"],
    byeWeek: 10,
    availability: available,
    locked: true,
    weeks: [760, 140, 980, 390],
  },
  {
    id: "BN-11",
    slot: "IR",
    positions: ["IR"],
    byeWeek: 13,
    availability: injuredReserve,
    locked: true,
    weeks: [0, 0, 0, 0],
  },
  {
    id: "BN-12",
    slot: "BN",
    positions: ["RB", "W/R/T"],
    byeWeek: 10,
    availability: available,
    locked: true,
    weeks: [1070, 1930, 70, 1460],
  },
  {
    id: "BN-13",
    slot: "BN",
    positions: ["WR", "W/R/T"],
    byeWeek: 7,
    availability: available,
    locked: false,
    weeks: [160, 1320, 1100, 1340],
  },
  {
    id: "K-14",
    slot: "K",
    positions: ["K"],
    byeWeek: 11,
    availability: available,
    locked: true,
    weeks: [1000, 900, 1200, 100],
  },
  {
    id: "DEF-15",
    slot: "DEF",
    positions: ["DEF"],
    byeWeek: 11,
    availability: available,
    locked: true,
    weeks: [-100, 500, 600, 600],
  },
];

function recordedFootballInput(locked: boolean): LineupPolicyInput {
  return {
    period: target,
    source: rulesSource(recordedRoster.map((row) => ({ id: row.id, weeks: row.weeks }))),
    slots: footballSlots(),
    players: recordedRoster.map((row) => ({
      id: makePlayerId(row.id),
      eligiblePositions: row.positions,
      availability: row.availability,
      locked: locked && row.locked,
      currentSlotId: makeSlotId(row.slot),
      nonGamePeriods: [week(row.byeWeek)],
    })),
  };
}

function footballSlots(): ReadonlyArray<RosterSlot> {
  return [
    startingSlot("QB", 1, ["QB"]),
    startingSlot("RB", 2, ["RB"]),
    startingSlot("WR", 2, ["WR"]),
    startingSlot("TE", 1, ["TE"]),
    startingSlot("W/R/T", 1, ["W/R/T"]),
    startingSlot("K", 1, ["K"]),
    startingSlot("DEF", 1, ["DEF"]),
    benchSlot("BN", 6),
    reserveSlot("IR", 1, ["IR"]),
  ];
}

function rulesSource(
  players: ReadonlyArray<{ readonly id: string; readonly weeks: ReadonlyArray<number | null> }>,
): Extract<ValueSource, { readonly kind: "scoring-rules" }> {
  return {
    kind: "scoring-rules",
    window: [3, 4, 5, 6].map(week),
    scoring: unitRule,
    observations: observationsFor(players),
  };
}

function startedSource(
  entries: ReadonlyArray<{
    readonly id: string;
    readonly percent: number | undefined;
    readonly cuts: ReadonlyArray<{ readonly cut: string; readonly percent: number }>;
  }>,
): Extract<ValueSource, { readonly kind: "percent-started" }> {
  return {
    kind: "percent-started",
    started: entries.map((entry): PlayerPercentStarted => ({
      id: makePlayerId(entry.id),
      percent: entry.percent === undefined ? undefined : parseExact(String(entry.percent)),
      cuts: entry.cuts.map((cut): PercentStartedCut => ({
        cut: cut.cut,
        percent: parseExact(String(cut.percent)),
      })),
    })),
  };
}

function inputFor(input: {
  readonly source: ValueSource;
  readonly players: ReadonlyArray<{
    readonly id: string;
    readonly slot: string;
    readonly positions: ReadonlyArray<string>;
    readonly availability?: PlayerAvailability;
  }>;
  readonly slots?: ReadonlyArray<RosterSlot>;
}): LineupPolicyInput {
  return {
    period: target,
    source: input.source,
    slots: input.slots ?? quarterbackSlots(),
    players: input.players.map((player) => ({
      id: makePlayerId(player.id),
      eligiblePositions: player.positions,
      availability: player.availability ?? available,
      locked: false,
      currentSlotId: makeSlotId(player.slot),
      nonGamePeriods: [],
    })),
  };
}

function rosterInput(input: {
  readonly players: ReadonlyArray<{
    readonly id: string;
    readonly weeks: ReadonlyArray<number | null>;
    readonly availability?: PlayerAvailability;
    readonly slot?: string;
    readonly positions?: ReadonlyArray<string>;
  }>;
  readonly slots?: ReadonlyArray<RosterSlot>;
}): LineupPolicyInput {
  return {
    period: target,
    source: rulesSource(input.players),
    slots: input.slots ?? quarterbackSlots(),
    players: input.players.map((player) =>
      policyPlayer({
        id: player.id,
        availability: player.availability,
        slot: player.slot,
        positions: player.positions,
      }),
    ),
  };
}

function quarterbackSlots(
  requirement: "required" | "optional" = "required",
): ReadonlyArray<RosterSlot> {
  return [
    {
      kind: "starting",
      id: makeSlotId("QB"),
      capacity: 1,
      requirement,
      eligibility: { kind: "positions", positions: ["QB"] },
    },
    benchSlot("BN", 2),
  ];
}

function availabilityInput(input: {
  readonly weeks: ReadonlyArray<number | null>;
  readonly availability?: PlayerAvailability;
  readonly nonGamePeriods?: ReadonlyArray<Period>;
  readonly slot?: string;
  readonly positions?: ReadonlyArray<string>;
}): LineupPolicyInput {
  return {
    period: target,
    source: rulesSource([
      { id: "p1", weeks: input.weeks },
      { id: "p2", weeks: [1000, 1000, 1000, 1000] },
    ]),
    slots: footballSlots(),
    players: [
      policyPlayer({
        id: "p1",
        availability: input.availability ?? available,
        slot: input.slot ?? "BN",
        positions: input.positions ?? ["QB", "W/R/T", "IR"],
        nonGamePeriods: input.nonGamePeriods ?? [],
      }),
      policyPlayer({ id: "p2", slot: "BN", positions: ["QB"] }),
    ],
  };
}

function policyPlayer(input: {
  readonly id: string;
  readonly availability?: PlayerAvailability;
  readonly slot?: string;
  readonly positions?: ReadonlyArray<string>;
  readonly nonGamePeriods?: ReadonlyArray<Period>;
}): PolicyPlayer {
  return {
    id: makePlayerId(input.id),
    eligiblePositions: input.positions ?? ["QB", "W/R/T", "IR"],
    availability: input.availability ?? { kind: "available" },
    locked: false,
    currentSlotId: makeSlotId(input.slot ?? "BN"),
    nonGamePeriods: input.nonGamePeriods ?? [],
  };
}

function observationsFor(
  players: ReadonlyArray<{ readonly id: string; readonly weeks: ReadonlyArray<number | null> }>,
): ReadonlyArray<PeriodObservation> {
  return [3, 4, 5, 6].map((value, index) => ({
    period: week(value),
    players: players.map((player) => ({
      id: makePlayerId(player.id),
      stats: [{ statId: "1", value: player.weeks[index] ?? null }],
    })),
  }));
}

function startingSlot(
  id: string,
  capacity: number,
  positions: ReadonlyArray<string>,
): StartingSlot {
  return {
    kind: "starting",
    id: makeSlotId(id),
    capacity,
    requirement: "required",
    eligibility: { kind: "positions", positions },
  };
}

function benchSlot(id: string, capacity: number): BenchSlot {
  return { kind: "bench", id: makeSlotId(id), capacity, eligibility: { kind: "any" } };
}

function reserveSlot(id: string, capacity: number, positions: ReadonlyArray<string>): ReserveSlot {
  return {
    kind: "reserve",
    id: makeSlotId(id),
    capacity,
    eligibility: { kind: "positions", positions },
  };
}

function week(value: number): Period {
  return { kind: "week", week: value };
}

function problemFrom(result: LineupPolicyResult): LineupProblem {
  if (result.kind !== "problem") {
    throw new Error(`Expected a problem, received ${result.refusal.kind}.`);
  }
  return result.problem;
}

function realisedValue(
  valuation: PlayerValuation,
): Extract<PlayerValuation["value"], { readonly kind: "realised-points" }> {
  if (valuation.value.kind !== "realised-points") {
    throw new Error(`Expected a realised-points valuation, received ${valuation.value.kind}.`);
  }
  return valuation.value;
}

function knownUnits(valuation: PlayerValuation): number | undefined {
  return valuation.selection.kind === "known" ? valuation.selection.units : undefined;
}

function valuationFrom(result: LineupPolicyResult, playerId: string): PlayerValuation {
  if (result.kind !== "problem") {
    throw new Error(`Expected a problem, received ${result.refusal.kind}.`);
  }
  const valuation = result.valuations.find(
    (candidate) => candidate.playerId === makePlayerId(playerId),
  );
  if (valuation === undefined) {
    throw new Error(`No valuation for ${playerId}.`);
  }
  return valuation;
}

function unitsByPlayer(result: LineupPolicyResult): Readonly<Record<string, number>> {
  if (result.kind !== "problem") {
    throw new Error(`Expected a problem, received ${result.refusal.kind}.`);
  }
  return Object.fromEntries(
    result.valuations.map((valuation) => [valuation.playerId, knownUnits(valuation) ?? -1]),
  );
}

function selectionBases(result: LineupPolicyResult): ReadonlyArray<string> {
  if (result.kind !== "problem") {
    throw new Error(`Expected a problem, received ${result.refusal.kind}.`);
  }
  return result.problem.players.map((player) => player.selection.basis);
}

function planFrom(result: LineupSolveResult): LineupPlan {
  if (result.kind !== "plan") {
    throw new Error(`Expected a plan, received ${result.refusal.reason}.`);
  }
  return result.plan;
}

function startingPlayerIds(plan: LineupPlan): ReadonlyArray<string> {
  const startingSlots = new Set(
    footballSlots()
      .filter(isStartingSlot)
      .map((slot) => slot.id),
  );
  return plan.assignments
    .filter((assignment) => startingSlots.has(assignment.slotId))
    .map((assignment) => assignment.playerId);
}
