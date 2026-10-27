import { describe, expect, it } from "vitest";

import { parseExact } from "./Exact.ts";
import { scoreLineup } from "./LineupScore.ts";
import type { LineupScoreInput, LineupScoreResult } from "./LineupScore.ts";
import { periodKey } from "./Period.ts";
import { scoringProfile } from "./ScoringProfile.ts";
import type { Period, PlayerAvailability, PolicyPlayer, ValueSource } from "./types.ts";

const target: Period = { kind: "week", week: 7 };
const window = [3, 4, 5, 6].map((week) => ({ kind: "week" as const, week }));
const unitRule = scoringProfile({ categories: [], rules: [{ statId: 1, points: "0.01" }] });

describe("scoring from completed periods", () => {
  it("values a player by the mean of the counted completed periods", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [scoringRules([1000, 2000, 2000, 3001])],
          players: [player("p1")],
        }),
      ),
    );

    expect(result.players[0]?.units).toBe(2000);
    expect(realised(result, "p1").countedPeriods.map(periodKey)).toEqual([
      "week:3",
      "week:4",
      "week:5",
      "week:6",
    ]);
    expect(realised(result, "p1").average).toEqual(parseExact("20"));
    expect(result.label).toBe("mean-points-per-period:week:3,week:4,week:5,week:6");
  });

  it("skips a completed period the player had no game in", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [scoringRules([1000, 2000, 2000, 3001])],
          players: [player("p1", { kind: "available" }, [{ kind: "week", week: 5 }])],
        }),
      ),
    );

    expect(realised(result, "p1").skippedPeriods.map(periodKey)).toEqual(["week:5"]);
    expect(result.players[0]?.units).toBe(2000);
  });

  it("skips a completed period the provider published no observation for", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [scoringRules([1000, undefined, 2000, 3000])],
          players: [player("p1")],
        }),
      ),
    );

    expect(realised(result, "p1").skippedPeriods.map(periodKey)).toEqual(["week:4"]);
    expect(result.players[0]?.units).toBe(2000);
  });

  it("skips a completed period whose scored total is unknown", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [
            {
              kind: "scoring-rules",
              window,
              scoring: unitRule,
              observations: observations([
                { week: 3, stats: [[1, 100]] },
                { week: 4, stats: [[1, null]] },
                { week: 5, stats: [[1, 200]] },
                { week: 6, stats: [[1, 300]] },
              ]),
            },
          ],
          players: [player("p1")],
        }),
      ),
    );

    expect(realised(result, "p1").skippedPeriods.map(periodKey)).toEqual(["week:4"]);
    expect(result.players[0]?.units).toBe(200);
  });

  it("values a player with no counted period at zero and records the missing mean", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [scoringRules([undefined, undefined, undefined, undefined])],
          players: [player("p1")],
        }),
      ),
    );

    expect(result.players[0]?.units).toBe(0);
    expect(realised(result, "p1").average).toBeUndefined();
    expect(realised(result, "p1").countedPeriods).toEqual([]);
  });
});

describe("availability", () => {
  const tiers: ReadonlyArray<readonly [PlayerAvailability, string]> = [
    [{ kind: "available" }, "will-play"],
    [{ kind: "uncertain", code: "DTD" }, "might-play"],
    [{ kind: "unrecognised", code: "PUP-2027" }, "might-play"],
    [{ kind: "excluded", reason: "out" }, "will-not-play"],
    [{ kind: "excluded", reason: "injured-reserve" }, "will-not-play"],
    [{ kind: "excluded", reason: "suspended" }, "will-not-play"],
    [{ kind: "excluded", reason: "not-active" }, "will-not-play"],
  ];

  it.each(tiers)("places %j on the %s tier", (availability, tier) => {
    const result = scored(
      scoreLineup(
        input({
          sources: [scoringRules([1000, 1000, 1000, 1000])],
          players: [player("p1", availability)],
        }),
      ),
    );

    expect(result.players[0]?.availability.tier).toBe(tier);
  });

  it("places a player with no game in the target period on the lowest tier", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [scoringRules([1000, 1000, 1000, 1000])],
          players: [player("p1", { kind: "available" }, [{ kind: "week", week: 7 }])],
        }),
      ),
    );

    expect(result.players[0]?.availability).toEqual({
      tier: "not-scheduled",
      fact: "no-game",
      period: target,
    });
  });

  it("keeps the same score whatever the availability tier", () => {
    const available = scored(
      scoreLineup(
        input({ sources: [scoringRules([1000, 2000, 3000, 4000])], players: [player("p1")] }),
      ),
    );
    const excluded = scored(
      scoreLineup(
        input({
          sources: [scoringRules([1000, 2000, 3000, 4000])],
          players: [player("p1", { kind: "excluded", reason: "out" })],
        }),
      ),
    );

    expect(available.players[0]?.units).toBe(excluded.players[0]?.units);
    expect(available.players[0]?.availability.tier).not.toBe(
      excluded.players[0]?.availability.tier,
    );
  });
});

describe("the value source ladder", () => {
  it("takes the most preferred source that yields values", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [
            { kind: "community-start-rate", started: [startRate("p1", "43")] },
            projected("p1", "12.5"),
          ],
          players: [player("p1")],
        }),
      ),
    );

    expect(result.players[0]?.units).toBe(1250);
    expect(result.label).toBe("projected-points:week:7");
  });

  it("records a realised total alongside a projection without adding it", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [
            {
              kind: "projected-points",
              projections: [{ id: "p1", points: parseExact("12.5") }],
              realised: [{ id: "p1", points: parseExact("30") }],
            },
          ],
          players: [player("p1")],
        }),
      ),
    );

    expect(result.players[0]?.units).toBe(1250);
    expect(result.players[0]?.value).toEqual({
      kind: "projected-points",
      projection: parseExact("12.5"),
      realised: parseExact("30"),
    });
  });

  it("leaves a player without a projection without a score", () => {
    const result = scored(
      scoreLineup(input({ sources: [projected("p2", "12.5")], players: [player("p1")] })),
    );

    expect(result.players[0]?.units).toBeUndefined();
  });

  it("values a started percentage in hundredths and keeps a zero", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [
            {
              kind: "community-start-rate",
              started: [startRate("p1", "43"), startRate("p2", "0")],
            },
          ],
          players: [player("p1"), player("p2")],
        }),
      ),
    );

    expect(result.players.map((entry) => entry.units)).toEqual([4300, 0]);
    expect(result.label).toBe("community-start-rate:overall:platinum-cut-incomplete:week:7");
  });

  it("prices from the populated platinum cut when every measured player carries it", () => {
    const started = [
      startRate("p1", "43", [{ cut: "platinum", percent: "51" }]),
      startRate("p2", "12", [{ cut: "platinum", percent: "8" }]),
    ];

    const result = scored(
      scoreLineup(
        input({
          sources: [{ kind: "community-start-rate", started }],
          players: [player("p1"), player("p2")],
        }),
      ),
    );

    expect(result.players.map((entry) => entry.units)).toEqual([5100, 800]);
    expect(result.label).toBe("community-start-rate:cut-platinum:week:7");
  });

  it("ignores a cut the request did not ask for", () => {
    const started = [
      startRate("p1", "43", [{ cut: "diamond", percent: "51" }]),
      startRate("p2", "12", [{ cut: "diamond", percent: "8" }]),
    ];

    const result = scored(
      scoreLineup(
        input({
          sources: [{ kind: "community-start-rate", started }],
          players: [player("p1"), player("p2")],
        }),
      ),
    );

    expect(result.players.map((entry) => entry.units)).toEqual([4300, 1200]);
    expect(result.label).toBe("community-start-rate:overall:platinum-cut-incomplete:week:7");
  });

  it("records a uniformly zero cut as a finding and prices from the overall percentage", () => {
    const started = [
      startRate("p1", "43", [{ cut: "platinum", percent: "0" }]),
      startRate("p2", "12", [{ cut: "platinum", percent: "0" }]),
    ];

    const result = scored(
      scoreLineup(
        input({
          sources: [{ kind: "community-start-rate", started }],
          players: [player("p1"), player("p2")],
        }),
      ),
    );

    expect(result.label).toBe("community-start-rate:overall:platinum-cut-unpopulated:week:7");
    expect(result.players.map((entry) => entry.units)).toEqual([4300, 1200]);
    expect(result.players[0]?.value).toEqual({
      kind: "community-start-rate",
      population: { kind: "overall", cut: "platinum", finding: "cut-unpopulated" },
      percent: parseExact("43"),
    });
  });

  it("uses one population for the whole plan when the cut omits a measured player", () => {
    const started = [
      startRate("p1", "43", [{ cut: "platinum", percent: "51" }]),
      startRate("p2", "12", [{ cut: "platinum", percent: "8" }]),
      startRate("p3", "40"),
    ];

    const result = scored(
      scoreLineup(
        input({
          sources: [{ kind: "community-start-rate", started }],
          players: [player("p1"), player("p2"), player("p3")],
        }),
      ),
    );

    expect(result.label).toBe("community-start-rate:overall:platinum-cut-incomplete:week:7");
    expect(result.players.map((entry) => entry.units)).toEqual([4300, 1200, 4000]);
  });

  it("keeps a zero cut value when the cut population is populated", () => {
    const started = [
      startRate("p1", "43", [{ cut: "platinum", percent: "51" }]),
      startRate("p2", "12", [{ cut: "platinum", percent: "0" }]),
    ];

    const result = scored(
      scoreLineup(
        input({
          sources: [{ kind: "community-start-rate", started }],
          players: [player("p1"), player("p2")],
        }),
      ),
    );

    expect(result.players.map((entry) => entry.units)).toEqual([5100, 0]);
    expect(result.label).toBe("community-start-rate:cut-platinum:week:7");
  });

  it("leaves a missing started percentage absent rather than zero", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [
            {
              kind: "community-start-rate",
              started: [startRate("p1", "43"), startRate("p2", null)],
            },
          ],
          players: [player("p1"), player("p2")],
        }),
      ),
    );

    expect(result.players[0]?.units).toBe(4300);
    expect(result.players[1]?.units).toBeUndefined();
  });

  it("moves past a window with no completed period to the next source", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [
            { kind: "scoring-rules", window: [], scoring: unitRule, observations: [] },
            { kind: "community-start-rate", started: [startRate("p1", "43")] },
          ],
          players: [player("p1")],
        }),
      ),
    );

    expect(result.label).toBe("community-start-rate:overall:platinum-cut-incomplete:week:7");
  });

  it("refuses transiently when the only source has no completed period", () => {
    const verdict = scoreLineup(
      input({
        sources: [{ kind: "scoring-rules", window: [], scoring: unitRule, observations: [] }],
        players: [player("p1")],
      }),
    );

    expect(verdict).toEqual({
      kind: "refused",
      refusal: "transient",
      code: "policy:no-observed-periods",
      detail:
        "No completed scoring period is available to value the roster, so the custom policy cannot plan a lineup.",
    });
  });

  it("refuses structurally when the provider contributes no source at all", () => {
    const verdict = scoreLineup(input({ sources: [], players: [player("p1")] }));

    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") {
      return;
    }
    expect(verdict.refusal).toBe("structural");
    expect(verdict.code).toBe("policy:no-value-source");
  });
});

describe("input consistency", () => {
  it("rejects the same player twice", () => {
    expect(() =>
      scoreLineup(
        input({
          sources: [scoringRules([1000, 1000, 1000, 1000])],
          players: [player("p1"), player("p1")],
        }),
      ),
    ).toThrow("A policy roster must not contain the same player twice.");
  });

  it("rejects a target period inside its own observation window", () => {
    expect(() =>
      scoreLineup(
        input({
          sources: [
            {
              kind: "scoring-rules",
              window: [target],
              scoring: unitRule,
              observations: [observation(target, [[1, 1]])],
            },
          ],
          players: [player("p1")],
        }),
      ),
    ).toThrow("The target period cannot belong to its own observation window.");
  });

  it("rejects an observation outside the declared window", () => {
    expect(() =>
      scoreLineup(
        input({
          sources: [
            {
              kind: "scoring-rules",
              window: [{ kind: "week", week: 6 }],
              scoring: unitRule,
              observations: [observation({ kind: "week", week: 5 }, [[1, 1]])],
            },
          ],
          players: [player("p1")],
        }),
      ),
    ).toThrow("Observation period week:5 is outside the declared window.");
  });

  it("rejects an observation for a player who is not on the roster", () => {
    expect(() =>
      scoreLineup(
        input({
          sources: [
            {
              kind: "scoring-rules",
              window: [{ kind: "week", week: 6 }],
              scoring: unitRule,
              observations: [observation({ kind: "week", week: 6 }, [[1, 1]], "p9")],
            },
          ],
          players: [player("p1")],
        }),
      ),
    ).toThrow("Observation for player p9 is not on the policy roster.");
  });

  it("rejects a duplicated projection", () => {
    expect(() =>
      scoreLineup(
        input({
          sources: [
            {
              kind: "projected-points",
              projections: [
                { id: "p1", points: parseExact("1") },
                { id: "p1", points: parseExact("2") },
              ],
              realised: [],
            },
          ],
          players: [player("p1")],
        }),
      ),
    ).toThrow("Duplicate projection for player p1.");
  });
});

function input(facts: {
  readonly sources: ReadonlyArray<ValueSource>;
  readonly players: ReadonlyArray<PolicyPlayer>;
}): LineupScoreInput {
  return { period: target, sources: facts.sources, players: facts.players };
}

function player(
  id: string,
  availability: PlayerAvailability = { kind: "available" },
  nonGamePeriods: ReadonlyArray<Period> = [],
  scheduled = true,
): PolicyPlayer {
  return { id, availability, scheduled, nonGamePeriods };
}

function scoringRules(values: ReadonlyArray<number | undefined>): ValueSource {
  return {
    kind: "scoring-rules",
    window,
    scoring: unitRule,
    observations: observations(
      values.map((value, index) => ({
        week: window[index]?.week ?? 0,
        stats: [[1, value] as const],
      })),
    ),
  };
}

function observations(
  entries: ReadonlyArray<{
    readonly week: number;
    readonly stats: ReadonlyArray<readonly [number, number | null | undefined]>;
  }>,
): Extract<ValueSource, { readonly kind: "scoring-rules" }>["observations"] {
  return entries.flatMap((entry) => {
    const stats = entry.stats.flatMap(([statId, value]) =>
      value === undefined ? [] : [{ statId: String(statId), value }],
    );
    return stats.length === 0
      ? []
      : [{ period: { kind: "week" as const, week: entry.week }, players: [{ id: "p1", stats }] }];
  });
}

function observation(
  period: Period,
  stats: ReadonlyArray<readonly [number, number]>,
  playerId = "p1",
): Extract<ValueSource, { readonly kind: "scoring-rules" }>["observations"][number] {
  return {
    period,
    players: [
      { id: playerId, stats: stats.map(([statId, value]) => ({ statId: String(statId), value })) },
    ],
  };
}

function projected(playerId: string, points: string): ValueSource {
  return {
    kind: "projected-points",
    projections: [{ id: playerId, points: parseExact(points) }],
    realised: [],
  };
}

function startRate(
  playerId: string,
  percent: string | null,
  cuts: ReadonlyArray<{ readonly cut: string; readonly percent: string }> = [],
): {
  readonly id: string;
  readonly percent: ReturnType<typeof parseExact> | undefined;
  readonly cuts: ReadonlyArray<{
    readonly cut: string;
    readonly percent: ReturnType<typeof parseExact>;
  }>;
} {
  return {
    id: playerId,
    percent: percent === null ? undefined : parseExact(percent),
    cuts: cuts.map((cut) => ({ cut: cut.cut, percent: parseExact(cut.percent) })),
  };
}

function scored(result: LineupScoreResult): Extract<LineupScoreResult, { kind: "scored" }> {
  if (result.kind !== "scored") {
    throw new Error(`Expected scored values, received ${result.code}.`);
  }
  return result;
}

function realised(
  result: Extract<LineupScoreResult, { kind: "scored" }>,
  playerId: string,
): Extract<ValueAssessment, { readonly kind: "realised-points" }> {
  const value = result.players.find((entry) => entry.id === playerId)?.value;
  if (value === undefined || value.kind !== "realised-points") {
    throw new Error(`Expected a realised-points value for ${playerId}.`);
  }
  return value;
}

type ValueAssessment = Extract<
  Extract<LineupScoreResult, { kind: "scored" }>["players"][number]["value"],
  { readonly kind: "realised-points" }
>;
