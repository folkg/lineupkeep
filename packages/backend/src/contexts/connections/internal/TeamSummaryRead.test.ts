import { Effect, Schema } from "effect";
import { assert, describe, expect, it } from "vitest";

import type { StandingRow } from "#contexts/connections/QueryResults.ts";
import { CounterpartyRef, StatRef } from "#contexts/connections/QueryValues.ts";

import {
  categoryPointsSummary,
  categoryTotalsSummary,
  recordSummary,
  standingSummary,
  standingsSummary,
} from "./TeamSummaryRead.ts";

const league = { format: "head_to_head_categories" } as const;

const row = (overrides: Partial<StandingRow> = {}): StandingRow => ({
  team: Effect.runSync(Schema.decodeEffect(CounterpartyRef)("team-1")),
  name: "First Team",
  current: true,
  rank: 1,
  gamesBack: null,
  pointsBack: null,
  points: 12.5,
  pointsFor: 100.5,
  pointsAgainst: 90.5,
  acquisitionUsage: { status: "not_published", detail: "No counter published." },
  ...overrides,
});

describe("team summary read models", () => {
  it("keeps an absent standing unsupported instead of inventing a rank", () => {
    assert.deepStrictEqual(
      standingSummary({ included: true, current: undefined, detail: "No standings." }),
      {
        status: "unsupported",
        detail: "No standings.",
      },
    );
    assert.strictEqual(
      standingSummary({ included: false, current: undefined, detail: "No standings." }),
      undefined,
    );
  });

  it("publishes a standing and omits absent streak and playoff seed", () => {
    expect(standingSummary({ included: true, current: row(), detail: "No standings." })).toEqual({
      status: "available",
      rank: 1,
      points: 12.5,
      gamesBack: null,
      pointsBack: null,
      pointsFor: 100.5,
      pointsAgainst: 90.5,
    });
  });

  it("distinguishes a missing record from a missing team", () => {
    assert.deepStrictEqual(
      recordSummary({ included: true, current: undefined, detail: "No standings." }),
      {
        status: "unsupported",
        detail: "No standings.",
      },
    );
    assert.deepStrictEqual(
      recordSummary({ included: true, current: row(), detail: "No standings." }),
      {
        status: "unsupported",
        detail: "This league format publishes a rank and season points but no win–loss record.",
      },
    );
  });

  it("publishes category values and the omission detail", () => {
    expect(
      categoryTotalsSummary({
        included: true,
        current: row({
          categories: [
            {
              stat: Effect.runSync(Schema.decodeEffect(StatRef)("s1")),
              name: "Goals",
              value: 10,
            },
          ],
        }),
        league,
        detail: "No standings.",
        omittedCount: 2,
      }),
    ).toEqual({
      status: "available",
      values: [{ stat: "s1", name: "Goals", value: 10 }],
      omittedCategories: {
        count: 2,
        detail:
          "2 stat ids in the standings have no league scoring definition and are omitted because they cannot be named.",
      },
    });
  });

  it("says why a category total is unavailable", () => {
    assert.deepStrictEqual(
      categoryTotalsSummary({
        included: true,
        current: row(),
        league: undefined,
        detail: "No standings.",
        omittedCount: 0,
      }),
      {
        status: "unsupported",
        detail:
          "The league scoring categories could not be read, so standings categories cannot be labelled.",
      },
    );
  });

  it("adds each rotisserie category's place among the league rows", () => {
    const goals = Effect.runSync(Schema.decodeEffect(StatRef)("s1"));
    const current = row({
      categoryPoints: [{ stat: goals, name: "Goals", value: 8 }],
    });
    const leader = row({
      current: false,
      name: "Leader",
      categoryPoints: [{ stat: goals, name: "Goals", value: 10 }],
    });
    const tied = row({
      current: false,
      name: "Tied",
      categoryPoints: [{ stat: goals, name: "Goals", value: 8 }],
    });
    const trailing = row({
      current: false,
      name: "Trailing",
      categoryPoints: [{ stat: goals, name: "Goals", value: 4 }],
    });

    expect(
      categoryPointsSummary({
        included: true,
        current,
        rows: [current, leader, tied, trailing],
        league: { format: "rotisserie" },
        detail: "No standings.",
        omittedCount: 0,
      }),
    ).toEqual({
      status: "available",
      values: [{ stat: goals, name: "Goals", value: 8, place: 2 }],
      omittedCategories: {
        count: 0,
        detail: "Every category your league published has a league scoring definition.",
      },
    });
  });

  it("leaves a place absent when a league row has no value", () => {
    const goals = Effect.runSync(Schema.decodeEffect(StatRef)("s1"));
    const current = row({
      categoryPoints: [{ stat: goals, name: "Goals", value: 8 }],
    });
    const missing = row({
      current: false,
      name: "Missing",
      categoryPoints: [{ stat: goals, name: "Goals", value: null }],
    });

    expect(
      categoryPointsSummary({
        included: true,
        current,
        rows: [current, missing],
        league: { format: "rotisserie" },
        detail: "No standings.",
        omittedCount: 0,
      }),
    ).toMatchObject({
      values: [{ stat: goals, name: "Goals", value: 8 }],
    });
  });

  it("refuses rotisserie points for a category league", () => {
    assert.deepStrictEqual(
      categoryPointsSummary({
        included: true,
        current: row(),
        rows: [],
        league,
        detail: "No standings.",
        omittedCount: 0,
      }),
      {
        status: "unsupported",
        detail: "Your league publishes rotisserie category points only for rotisserie leagues.",
      },
    );
  });

  it("says a rotisserie league published no category points", () => {
    assert.deepStrictEqual(
      categoryPointsSummary({
        included: true,
        current: row(),
        rows: [],
        league: { format: "rotisserie" },
        detail: "No standings.",
        omittedCount: 0,
      }),
      {
        status: "unsupported",
        detail: "Your league published no rotisserie points for this category.",
      },
    );
  });

  it("maps standings rows and omits a null games-back and points-back", () => {
    expect(
      standingsSummary({
        included: true,
        outcome: "ok",
        rows: [
          row({
            record: { wins: 3, losses: 2, ties: 1, percentage: 0.583 },
            gamesBack: 2,
            pointsBack: null,
          }),
        ],
        league,
        detail: "No standings.",
      }),
    ).toEqual({
      status: "available",
      format: "head_to_head_categories",
      teams: [
        {
          team: "team-1",
          name: "First Team",
          current: true,
          rank: 1,
          wins: 3,
          losses: 2,
          ties: 1,
          percentage: 0.583,
          points: 12.5,
          gamesBack: 2,
        },
      ],
    });
  });
});
