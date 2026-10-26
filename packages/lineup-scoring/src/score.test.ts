import { describe, expect, it } from "vitest";

import { addExact, exactFromInteger, parseExact } from "./exact.ts";
import { describeScoring, scoringProfile } from "./profile.ts";
import { scorePeriod } from "./score.ts";
import type { Exact, StatObservation } from "./types.ts";

const recordedRules: ReadonlyArray<readonly [number, string]> = [
  [4, "0.04"],
  [5, "4"],
  [6, "-1"],
  [9, "0.1"],
  [10, "6"],
  [11, "1"],
  [12, "0.1"],
  [13, "6"],
  [15, "6"],
  [16, "2"],
  [18, "-2"],
  [57, "6"],
  [19, "3"],
  [20, "3"],
  [21, "3"],
  [22, "4"],
  [23, "5"],
  [29, "1"],
  [32, "1"],
  [33, "2"],
  [34, "2"],
  [35, "6"],
  [36, "2"],
  [37, "2"],
  [49, "6"],
  [50, "10"],
  [51, "7"],
  [52, "4"],
  [53, "1"],
  [54, "0"],
  [55, "-1"],
  [56, "-4"],
  [82, "2"],
];

const recordedCategories: ReadonlyArray<readonly [number, string]> = [
  [4, "Passing Yards"],
  [5, "Passing Touchdowns"],
  [6, "Interceptions"],
  [8, "Rushing Attempts"],
  [9, "Rushing Yards"],
  [10, "Rushing Touchdowns"],
  [78, "Targets"],
  [11, "Receptions"],
  [12, "Receiving Yards"],
  [13, "Receiving Touchdowns"],
  [15, "Return Touchdowns"],
  [16, "2-Point Conversions"],
  [18, "Fumbles Lost"],
  [57, "Offensive Fumble Return TD"],
  [19, "Field Goals 0-19 Yards"],
  [20, "Field Goals 20-29 Yards"],
  [21, "Field Goals 30-39 Yards"],
  [22, "Field Goals 40-49 Yards"],
  [23, "Field Goals 50+ Yards"],
  [29, "Point After Attempt Made"],
  [31, "Points Allowed"],
  [32, "Sack"],
  [33, "Interception"],
  [34, "Fumble Recovery"],
  [35, "Touchdown"],
  [36, "Safety"],
  [37, "Block Kick"],
  [49, "Kickoff and Punt Return Touchdowns"],
  [50, "Points Allowed 0 points"],
  [51, "Points Allowed 1-6 points"],
  [52, "Points Allowed 7-13 points"],
  [53, "Points Allowed 14-20 points"],
  [54, "Points Allowed 21-27 points"],
  [55, "Points Allowed 28-34 points"],
  [56, "Points Allowed 35+ points"],
  [82, "Extra Point Returned"],
];

const recordedWeekStats: ReadonlyArray<{
  slot: string;
  stats: ReadonlyArray<readonly [number, number]>;
}> = [
  {
    slot: "QB",
    stats: [
      [4, 253],
      [5, 2],
      [6, 1],
      [8, 1],
      [9, -1],
      [10, 0],
      [78, 0],
      [11, 0],
      [12, 0],
      [13, 0],
      [15, 0],
      [16, 0],
      [18, 0],
      [57, 0],
    ],
  },
  {
    slot: "RB",
    stats: [
      [4, 0],
      [5, 0],
      [6, 0],
      [8, 19],
      [9, 46],
      [10, 0],
      [78, 3],
      [11, 2],
      [12, 3],
      [13, 0],
      [15, 0],
      [16, 0],
      [18, 0],
      [57, 0],
    ],
  },
  {
    slot: "RB",
    stats: [
      [4, 0],
      [5, 0],
      [6, 0],
      [8, 12],
      [9, 39],
      [10, 0],
      [78, 4],
      [11, 4],
      [12, 48],
      [13, 2],
      [15, 0],
      [16, 0],
      [18, 0],
      [57, 0],
    ],
  },
  {
    slot: "WR",
    stats: [
      [4, 0],
      [5, 0],
      [6, 0],
      [8, 0],
      [9, 0],
      [10, 0],
      [78, 10],
      [11, 4],
      [12, 62],
      [13, 0],
      [15, 0],
      [16, 1],
      [18, 0],
      [57, 0],
    ],
  },
  {
    slot: "WR",
    stats: [
      [4, 0],
      [5, 0],
      [6, 0],
      [8, 0],
      [9, 0],
      [10, 0],
      [78, 7],
      [11, 6],
      [12, 80],
      [13, 0],
      [15, 0],
      [16, 0],
      [18, 0],
      [57, 0],
    ],
  },
  {
    slot: "TE",
    stats: [
      [4, 0],
      [5, 0],
      [6, 0],
      [8, 0],
      [9, 0],
      [10, 0],
      [78, 3],
      [11, 1],
      [12, 9],
      [13, 0],
      [15, 0],
      [16, 0],
      [18, 0],
      [57, 0],
    ],
  },
  {
    slot: "W/R/T",
    stats: [
      [4, 0],
      [5, 0],
      [6, 0],
      [8, 0],
      [9, 0],
      [10, 0],
      [78, 7],
      [11, 4],
      [12, 43],
      [13, 1],
      [15, 0],
      [16, 0],
      [18, 0],
      [57, 0],
    ],
  },
  {
    slot: "BN",
    stats: [
      [4, 0],
      [5, 0],
      [6, 0],
      [8, 0],
      [9, 0],
      [10, 0],
      [78, 7],
      [11, 7],
      [12, 73],
      [13, 0],
      [15, 0],
      [16, 0],
      [18, 0],
      [57, 0],
    ],
  },
  {
    slot: "BN",
    stats: [
      [4, 0],
      [5, 0],
      [6, 0],
      [8, 7],
      [9, 31],
      [10, 0],
      [78, 1],
      [11, 1],
      [12, 9],
      [13, 0],
      [15, 0],
      [16, 0],
      [18, 1],
      [57, 0],
    ],
  },
  {
    slot: "BN",
    stats: [
      [4, 0],
      [5, 0],
      [6, 0],
      [8, 0],
      [9, 0],
      [10, 0],
      [78, 3],
      [11, 2],
      [12, 19],
      [13, 0],
      [15, 0],
      [16, 0],
      [18, 0],
      [57, 0],
    ],
  },
  {
    slot: "BN",
    stats: [
      [4, 0],
      [5, 0],
      [6, 0],
      [8, 0],
      [9, 0],
      [10, 0],
      [78, 0],
      [11, 0],
      [12, 0],
      [13, 0],
      [15, 0],
      [16, 0],
      [18, 0],
      [57, 0],
    ],
  },
  {
    slot: "BN",
    stats: [
      [4, 0],
      [5, 0],
      [6, 0],
      [8, 6],
      [9, 25],
      [10, 1],
      [78, 4],
      [11, 3],
      [12, 31],
      [13, 0],
      [15, 0],
      [16, 0],
      [18, 0],
      [57, 0],
    ],
  },
  {
    slot: "BN",
    stats: [
      [4, 0],
      [5, 0],
      [6, 0],
      [8, 0],
      [9, 0],
      [10, 0],
      [78, 6],
      [11, 4],
      [12, 34],
      [13, 1],
      [15, 0],
      [16, 0],
      [18, 0],
      [57, 0],
    ],
  },
  {
    slot: "K",
    stats: [
      [19, 0],
      [20, 0],
      [21, 0],
      [22, 0],
      [23, 0],
      [29, 1],
    ],
  },
  {
    slot: "DEF",
    stats: [
      [31, 19],
      [32, 3],
      [33, 1],
      [34, 0],
      [35, 0],
      [36, 0],
      [37, 0],
      [49, 0],
      [50, 0],
      [51, 0],
      [52, 0],
      [53, 1],
      [54, 0],
      [55, 0],
      [56, 0],
      [82, 0],
    ],
  },
];

const recordedProfile = scoringProfile({
  categories: recordedCategories.map(([statId, label]) => ({ statId, label })),
  rules: recordedRules.map(([statId, points]) => ({ statId, points })),
});

const startingSlots = new Set(["QB", "RB", "WR", "TE", "W/R/T", "K", "DEF"]);

function observations(
  stats: ReadonlyArray<readonly [number, number]>,
): ReadonlyArray<StatObservation> {
  return stats.map(([statId, value]) => ({ statId: String(statId), value }));
}

describe("league scoring", () => {
  it("adds each scored stat's modifier and ignores stats the league does not score", () => {
    const score = scorePeriod(recordedProfile, [
      { statId: "4", value: 253 },
      { statId: "5", value: 2 },
      { statId: "6", value: 1 },
      { statId: "8", value: 1 },
      { statId: "9", value: -1 },
      { statId: "31", value: 19 },
      { statId: "78", value: 4 },
    ]);

    expect(score.kind).toBe("scored");
    expect(score.kind === "scored" ? score.points : undefined).toEqual(parseExact("17.02"));
    expect(score.coverage.unscored).toEqual(["8", "31", "78"]);
    expect(score.coverage.scored).toEqual(["4", "5", "6", "9"]);
  });

  it("leaves an absent scored stat contributing nothing", () => {
    const score = scorePeriod(recordedProfile, [{ statId: "5", value: 1 }]);

    expect(score.kind === "scored" ? score.points : undefined).toEqual(parseExact("4"));
    expect(score.coverage.absent).toContain("4");
    expect(score.coverage.unknown).toEqual([]);
  });

  it("keeps a zero stat value as a known zero", () => {
    const score = scorePeriod(recordedProfile, [
      { statId: "4", value: 0 },
      { statId: "5", value: 0 },
    ]);

    expect(score.kind === "scored" ? score.points : undefined).toEqual(parseExact("0"));
  });

  it("refuses to total a period whose scored stat value is unknown", () => {
    const score = scorePeriod(recordedProfile, [
      { statId: "4", value: 253 },
      { statId: "5", value: null },
    ]);

    expect(score.kind).toBe("unknown");
    expect(score.kind === "unknown" ? score.reasons : []).toEqual([
      { kind: "value-unknown", statId: "5" },
    ]);
  });

  it("treats a period with no statistics as unknown rather than zero", () => {
    const score = scorePeriod(recordedProfile, []);

    expect(score.kind).toBe("unknown");
    expect(score.kind === "unknown" ? score.reasons : []).toEqual([{ kind: "no-observations" }]);
  });

  it("accepts decimal stat values exactly", () => {
    const profile = scoringProfile({ categories: [], rules: [{ statId: 23, points: "0.5" }] });
    const score = scorePeriod(profile, [{ statId: "23", value: "2.35" }]);

    expect(score.kind === "scored" ? score.points : undefined).toEqual(parseExact("1.175"));
  });

  it("rejects two observations of one stat in one period", () => {
    expect(() =>
      scorePeriod(recordedProfile, [
        { statId: "4", value: 1 },
        { statId: "4", value: 2 },
      ]),
    ).toThrow(/Duplicate observation/u);
  });
});

describe("recorded league", () => {
  it("reproduces the provider's own weekly team total", () => {
    const points = recordedWeekStats.map((row) => {
      const score = scorePeriod(recordedProfile, observations(row.stats));
      return { slot: row.slot, points: score.kind === "scored" ? score.points : undefined };
    });
    const totalFor = (starting: boolean): Exact =>
      points
        .filter((row) => startingSlots.has(row.slot) === starting)
        .reduce((sum, row) => {
          if (row.points === undefined) {
            throw new Error(`Recorded ${row.slot} row has no scored total.`);
          }
          return addExact(sum, row.points);
        }, exactFromInteger(0n));

    expect(totalFor(true)).toEqual(parseExact("98.02"));
    expect(totalFor(false)).toEqual(parseExact("49.2"));
  });

  it("reports the league's modifier coverage over the stat ids its players return", () => {
    const returnedStatIds = recordedWeekStats.flatMap((row) =>
      row.stats.map(([statId]) => String(statId)),
    );

    const coverage = describeScoring(recordedProfile, [...new Set(returnedStatIds)]);

    expect(new Set(coverage.scored)).toEqual(
      new Set(recordedRules.map(([statId]) => String(statId))),
    );
    expect(coverage.unscored).toEqual(["8", "31", "78"]);
    expect(coverage.unusedRules).toEqual([]);
    expect(coverage.rulesWithoutCategory).toEqual([]);
    expect(coverage.categoriesWithoutRule).toEqual(["8", "31", "78"]);
  });
});
