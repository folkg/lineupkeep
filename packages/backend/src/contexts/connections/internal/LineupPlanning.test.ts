import { describe, expect, it } from "vitest";

import type {
  ProviderLeagueSettings,
  ProviderPlayerValue,
  ProviderRoster,
  ProviderRosterPosition,
} from "#contexts/connections/Provider.ts";

import { planAssignments } from "./LineupPlanning.ts";
import type { PlanAssignmentsResult } from "./LineupPlanning.ts";

describe("provider-neutral lineup placement", () => {
  it("moves the highest scoring eligible player into a starting slot", () => {
    const result = planned(
      planAssignments({
        league: league(),
        roster: roster([member("p1", "QB", "QB", ["QB"]), member("p2", "QB", "BN", ["QB"])]),
        values: values([
          ["p1", 900],
          ["p2", 1800],
        ]),
      }),
    );

    expect(result.assignments).toEqual([
      { providerPlayerKey: "p1", slot: "BN" },
      { providerPlayerKey: "p2", slot: "QB" },
    ]);
  });

  it("sends only the changed assignments and covers every roster member", () => {
    const result = planned(
      planAssignments({
        league: league([
          { position: "QB", kind: "starting", count: 1, eligibility: ["QB"] },
          { position: "RB", kind: "starting", count: 1, eligibility: ["RB"] },
          { position: "BN", kind: "bench", count: 2, eligibility: [] },
        ]),
        roster: roster([
          member("p1", "QB", "QB", ["QB"]),
          member("p2", "RB", "RB", ["RB"]),
          member("p3", "RB", "BN", ["RB"]),
        ]),
        values: values([
          ["p1", 2100],
          ["p2", 1200],
          ["p3", 1500],
        ]),
      }),
    );

    expect(result.assignments).toEqual([
      { providerPlayerKey: "p2", slot: "BN" },
      { providerPlayerKey: "p3", slot: "RB" },
    ]);
  });

  it("keeps the recorded lineup when every player is locked", () => {
    const result = planned(
      planAssignments({
        league: league(),
        roster: roster([
          { ...member("p1", "QB", "QB", ["QB"]), isEditable: false },
          { ...member("p2", "QB", "BN", ["QB"]), isEditable: false },
        ]),
        values: values([
          ["p1", 900],
          ["p2", 1800],
        ]),
      }),
    );

    expect(result.assignments).toEqual([]);
  });

  it("refuses a plan that moves a player through a reserve slot", () => {
    const result = planAssignments({
      league: league([
        { position: "QB", kind: "starting", count: 1, eligibility: ["QB"] },
        { position: "IR", kind: "reserve", count: 1, eligibility: ["QB"] },
        { position: "BN", kind: "bench", count: 1, eligibility: [] },
      ]),
      roster: roster([
        member("p1", "QB", "QB", ["QB"]),
        member("p2", "QB", "IR", ["QB"]),
        member("p3", "QB", "BN", ["QB"]),
      ]),
      values: values([
        ["p1", 200],
        ["p2", 1900],
        ["p3", 100],
      ]),
    });

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") {
      return;
    }
    expect(result.detail).toContain("through a reserve slot");
  });

  it("refuses when a required starting slot has no eligible player", () => {
    const result = planAssignments({
      league: league([
        { position: "QB", kind: "starting", count: 1, eligibility: ["QB"] },
        { position: "BN", kind: "bench", count: 1, eligibility: [] },
      ]),
      roster: roster([member("p1", "RB", "BN", ["RB"])]),
      values: values([["p1", 900]]),
    });

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") {
      return;
    }
    expect(result.detail).toBe(
      "A required starting position cannot be filled from the current roster.",
    );
  });

  it("refuses when a player without a score has nowhere to sit", () => {
    const result = planAssignments({
      league: league([
        { position: "QB", kind: "starting", count: 1, eligibility: ["QB"] },
        { position: "RB", kind: "starting", count: 1, eligibility: ["RB"] },
      ]),
      roster: roster([member("p1", "QB", "QB", ["QB"]), member("p2", "RB", "QB", ["RB"])]),
      values: values([
        ["p1", 900],
        ["p2", null],
      ]),
    });

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") {
      return;
    }
    expect(result.detail).toContain("no usable selection value");
  });

  it("treats a player the provider reports no score for as unusable rather than zero", () => {
    const result = planned(
      planAssignments({
        league: league(),
        roster: roster([member("p1", "QB", "QB", ["QB"]), member("p2", "QB", "BN", ["QB"])]),
        values: values([
          ["p1", 0],
          ["p2", null],
        ]),
      }),
    );

    expect(result.assignments).toEqual([]);
  });

  it("refuses when the roster has more members than the declared slots", () => {
    const result = planAssignments({
      league: league([
        { position: "QB", kind: "starting", count: 1, eligibility: ["QB"] },
        { position: "BN", kind: "bench", count: 1, eligibility: [] },
      ]),
      roster: roster([
        member("p1", "QB", "QB", ["QB"]),
        member("p2", "QB", "BN", ["QB"]),
        member("p3", "QB", "BN", ["QB"]),
      ]),
      values: values([
        ["p1", 900],
        ["p2", 800],
        ["p3", 700],
      ]),
    });

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") {
      return;
    }
    expect(result.detail).toContain("more players than the league's declared slots");
  });
});

function planned(
  result: PlanAssignmentsResult,
): Extract<PlanAssignmentsResult, { kind: "planned" }> {
  if (result.kind !== "planned") {
    throw new Error(`Expected a plan, received ${result.detail}.`);
  }
  return result;
}

function league(
  positions: ReadonlyArray<Omit<ProviderRosterPosition, "positionType">> = [
    { position: "QB", kind: "starting", count: 1, eligibility: ["QB"] },
    { position: "BN", kind: "bench", count: 2, eligibility: [] },
  ],
): ProviderLeagueSettings {
  return {
    providerLeagueKey: "league",
    name: "League",
    webUrl: "https://example.test/league",
    season: 2026,
    startDate: undefined,
    endDate: undefined,
    teamCount: 10,
    format: "head_to_head_points",
    scoringType: "head",
    scoringLabel: "H2H",
    weeklyDeadline: undefined,
    waiverType: undefined,
    waiverRule: undefined,
    usesFaab: undefined,
    draftStatus: undefined,
    periodWindow: { current: 3, start: 1, end: 17 },
    rosterCoverage: "week",
    rosterPositions: positions.map((position) => ({ ...position, positionType: undefined })),
    statCategories: [],
    statModifiers: [],
  };
}

function roster(members: ReadonlyArray<ProviderRoster["players"][number]>): ProviderRoster {
  return {
    providerTeamKey: "team",
    providerLeagueKey: "league",
    coverage: { type: "week", week: 3 },
    players: members,
  };
}

function member(
  providerPlayerKey: string,
  primaryPosition: string,
  slot: string,
  eligiblePositions: ReadonlyArray<string>,
): ProviderRoster["players"][number] {
  return {
    providerPlayerKey,
    name: providerPlayerKey,
    displayPosition: primaryPosition,
    primaryPosition,
    positionType: undefined,
    proTeamAbbreviation: undefined,
    eligiblePositions,
    slot,
    isEditable: true,
    injuryCode: undefined,
    injuryDetail: undefined,
    byeWeek: null,
    scheduled: true,
    undroppable: null,
  };
}

function values(
  scores: ReadonlyArray<readonly [string, number | null]>,
): ReadonlyArray<ProviderPlayerValue> {
  return scores.map(([providerPlayerKey, score]) => ({
    providerPlayerKey,
    score,
    availability: "will-play",
  }));
}
