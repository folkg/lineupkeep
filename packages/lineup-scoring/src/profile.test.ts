import { describe, expect, it } from "vitest";

import { describeScoring, scoringProfile } from "./profile.ts";

const categories = [
  { statId: 4, label: "Passing Yards" },
  { statId: 8, label: "Rushing Attempts" },
  { statId: 31, label: "Points Allowed" },
  { statId: 78, label: "Targets" },
];

const rules = [
  { statId: 4, points: "0.04" },
  { statId: 6, points: "-1" },
];

describe("scoring profiles", () => {
  it("declares the decimal scale its rules need", () => {
    expect(scoringProfile({ categories, rules }).scale).toBe(2);
    expect(scoringProfile({ categories, rules: [{ statId: 4, points: "3" }] }).scale).toBe(0);
  });

  it("keeps unscored categories and unused rules as coverage rather than failures", () => {
    const profile = scoringProfile({ categories, rules });

    expect(describeScoring(profile, ["4", "8", "31"])).toEqual({
      scored: ["4"],
      unscored: ["8", "31"],
      unusedRules: ["6"],
      rulesWithoutCategory: ["6"],
      categoriesWithoutRule: ["8", "31", "78"],
    });
  });

  it("rejects a league that scores the same stat twice", () => {
    expect(() =>
      scoringProfile({
        categories,
        rules: [
          { statId: 4, points: "1" },
          { statId: 4, points: "2" },
        ],
      }),
    ).toThrow(/Duplicate scoring rule/u);
  });

  it("rejects a league that declares the same category twice", () => {
    expect(() =>
      scoringProfile({
        categories: [
          { statId: 4, label: "Passing Yards" },
          { statId: 4, label: "Passing Yards" },
        ],
        rules,
      }),
    ).toThrow(/Duplicate category/u);
  });

  it("rejects a modifier that is not a plain decimal", () => {
    expect(() => scoringProfile({ categories, rules: [{ statId: 4, points: "1/4" }] })).toThrow(
      /plain decimal/u,
    );
  });
});
