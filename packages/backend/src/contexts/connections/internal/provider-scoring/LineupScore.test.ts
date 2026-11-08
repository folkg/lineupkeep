import { describe, expect, it } from "vitest";

import { parseExact } from "./Exact.ts";
import { scoreLineup } from "./LineupScore.ts";
import type { LineupScoreInput, LineupScoreResult } from "./LineupScore.ts";
import type {
  Period,
  PlayerAvailability,
  PolicyPlayer,
  StartingLineup,
  StartingLineupRule,
  ValueSource,
} from "./types.ts";

const target: Period = { kind: "week", week: 7 };

describe("the period's projection", () => {
  it("values a player from your league's projected rank for the target period", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [projection({ p1: 1, p2: 4 })],
          players: [player("p1"), player("p2")],
        }),
      ),
    );

    expect(result.players.map((entry) => entry.units)).toEqual([4, 1]);
    expect(result.label).toBe("projected rank for week 7");
  });

  it("ranks the worst projected player on the roster at one unit so every value is positive", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [projection({ p1: 124, p2: 48 })],
          players: [player("p1"), player("p2")],
        }),
      ),
    );

    expect(result.players.map((entry) => entry.units)).toEqual([1, 77]);
  });

  it("leaves a player without a projection unscored rather than zero", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [projection({ p1: 12 })],
          players: [player("p1"), player("p2")],
        }),
      ),
    );

    expect(result.players[1]?.units).toBeUndefined();
  });

  it("falls to the started percentage when the projection yields no value at all", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [
            projection({}),
            {
              kind: "community-start-rate",
              started: [startRate("p1", "43", [{ cut: "platinum", percent: "43" }])],
            },
          ],
          players: [player("p1")],
        }),
      ),
    );

    expect(result.players[0]?.units).toBe(4300);
    expect(result.label).toBe("percent started for week 7 (platinum managers only)");
  });
});

describe("the value source ladder", () => {
  it("prices the plan from the projection, not from the started percentage", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [
            { kind: "community-start-rate", started: [startRate("p1", "91")] },
            projection({ p1: 2 }),
          ],
          players: [player("p1")],
        }),
      ),
    );

    expect(result.players[0]?.units).toBe(1);
    expect(result.label).toBe("projected rank for week 7");
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
    expect(result.label).toBe(
      "percent started for week 7 (using all managers, because a platinum-only figure was missing for one player)",
    );
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
    expect(result.label).toBe("percent started for week 7 (platinum managers only)");
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
    expect(result.label).toBe(
      "percent started for week 7 (using all managers, because a platinum-only figure was missing for one player)",
    );
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

    expect(result.label).toBe(
      "percent started for week 7 (using all managers, because no platinum manager started any player)",
    );
    expect(result.players.map((entry) => entry.units)).toEqual([4300, 1200]);
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

    expect(result.label).toBe(
      "percent started for week 7 (using all managers, because a platinum-only figure was missing for one player)",
    );
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
    expect(result.label).toBe("percent started for week 7 (platinum managers only)");
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

  it("refuses transiently, naming the projection, when no projection is published", () => {
    const verdict = scoreLineup(input({ sources: [projection({})], players: [player("p1")] }));

    expect(verdict).toEqual({
      kind: "refused",
      refusal: "transient",
      code: "policy:no-projection",
      detail:
        "Your league published no projected rank for any player on this roster for this period, so the custom policy cannot value the lineup.",
    });
  });

  it("refuses transiently, naming the start rate, when neither period signal is published", () => {
    const verdict = scoreLineup(
      input({
        sources: [
          projection({}),
          { kind: "community-start-rate", started: [startRate("p1", null)] },
        ],
        players: [player("p1")],
      }),
    );

    expect(verdict).toEqual({
      kind: "refused",
      refusal: "transient",
      code: "policy:no-start-rate",
      detail:
        "Your league published no started percentage for any player on this roster, so the custom policy cannot value the lineup.",
    });
  });

  it("refuses structurally when your league contributes no source at all", () => {
    const verdict = scoreLineup(input({ sources: [], players: [player("p1")] }));

    expect(verdict.kind).toBe("refused");
    if (verdict.kind !== "refused") {
      return;
    }
    expect(verdict.refusal).toBe("structural");
    expect(verdict.code).toBe("policy:no-value-source");
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
          sources: [projection({ p1: 1 })],
          players: [player("p1", availability)],
        }),
      ),
    );

    expect(result.players[0]?.availability).toBe(tier);
  });

  it("places a player with no game in the target period on the lowest tier", () => {
    const result = scored(
      scoreLineup(
        input({
          sources: [projection({ p1: 1 })],
          players: [player("p1", { kind: "available" }, [{ kind: "week", week: 7 }])],
        }),
      ),
    );

    expect(result.players[0]?.availability).toBe("not-scheduled");
  });

  it("keeps the same value whatever the availability tier", () => {
    const available = scored(
      scoreLineup(
        input({
          sources: [projection({ p1: 1, p2: 4 })],
          players: [player("p1")],
        }),
      ),
    );
    const excluded = scored(
      scoreLineup(
        input({
          sources: [projection({ p1: 1, p2: 4 })],
          players: [player("p1", { kind: "excluded", reason: "out" })],
        }),
      ),
    );

    expect(available.players[0]?.units).toBe(excluded.players[0]?.units);
    expect(available.players[0]?.availability).not.toBe(excluded.players[0]?.availability);
  });
});

describe("input consistency", () => {
  it("rejects the same player twice", () => {
    expect(() =>
      scoreLineup(
        input({
          sources: [projection({ p1: 1 })],
          players: [player("p1"), player("p1")],
        }),
      ),
    ).toThrow("A policy roster must not contain the same player twice.");
  });

  it("rejects a projection that covers a different period", () => {
    expect(() =>
      scoreLineup(
        input({
          sources: [
            {
              kind: "projection",
              period: { kind: "week", week: 6 },
              players: [{ id: "p1", rank: 1 }],
            },
          ],
          players: [player("p1")],
        }),
      ),
    ).toThrow("A projection for week:6 cannot price a lineup for week:7.");
  });

  it("rejects a projected rank that is not a positive integer", () => {
    expect(() =>
      scoreLineup(
        input({
          sources: [{ kind: "projection", period: target, players: [{ id: "p1", rank: 0 }] }],
          players: [player("p1")],
        }),
      ),
    ).toThrow("A projected rank must be a positive integer, received 0.");
  });

  it("rejects a player listed twice in one source", () => {
    expect(() =>
      scoreLineup(
        input({
          sources: [
            {
              kind: "projection",
              period: target,
              players: [
                { id: "p1", rank: 1 },
                { id: "p1", rank: 2 },
              ],
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
  startingLineup: StartingLineup = "unconfirmed",
  startingLineupRule: StartingLineupRule = "not-an-availability-fact",
): PolicyPlayer {
  return {
    id,
    availability,
    scheduled,
    startingLineup,
    startingLineupRule,
    nonGamePeriods,
  };
}

function projection(ranks: Readonly<Record<string, number | undefined>>): ValueSource {
  return {
    kind: "projection",
    period: target,
    players: Object.entries(ranks).flatMap(([id, rank]) =>
      rank === undefined ? [] : [{ id, rank }],
    ),
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
