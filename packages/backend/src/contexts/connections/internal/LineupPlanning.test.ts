import { describe, expect, it } from "vitest";

import type {
  ProviderAvailabilityTier,
  ProviderLeagueSettings,
  ProviderPlayerScore,
  ProviderRoster,
  ProviderRosterPosition,
} from "#contexts/connections/Provider.ts";

import { planAssignments } from "./LineupPlanning.ts";
import type { PlanAssignmentsResult } from "./LineupPlanning.ts";

describe("provider-neutral lineup placement", () => {
  it("moves the highest scoring eligible player into a starting slot", () => {
    const result = planned(
      planAssignments({
        gamesPlayed: [],
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
        gamesPlayed: [],
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
        gamesPlayed: [],
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

  it("orders every adjacent pair of availability rungs, whatever the values", () => {
    const ladder: ReadonlyArray<ProviderAvailabilityTier> = [
      "confirmed-start",
      "will-play",
      "might-play",
      "unlikely-to-play",
      "will-not-play",
      "not-scheduled",
    ];

    for (const [index, above] of ladder.entries()) {
      const below = ladder[index + 1];
      if (below === undefined) {
        continue;
      }
      const result = planned(
        planAssignments({
          gamesPlayed: [],
          league: league(),
          roster: roster([
            member("above", "QB", "BN", ["QB"], above),
            member("below", "QB", "QB", ["QB"], below),
          ]),
          values: values([
            ["above", 1, above],
            ["below", 9000, below],
          ]),
        }),
      );

      expect(result.assignments).toEqual([
        { providerPlayerKey: "above", slot: "QB" },
        { providerPlayerKey: "below", slot: "BN" },
      ]);
    }
  });

  it("fills a required starting slot with a player who cannot play when nobody else can", () => {
    const result = planned(
      planAssignments({
        gamesPlayed: [],
        league: league(),
        roster: roster([member("p1", "QB", "QB", ["QB"], "not-scheduled")]),
        values: values([["p1", 900, "not-scheduled"]]),
      }),
    );

    expect(result.assignments).toEqual([]);
  });

  it("keeps a bye player on the bench while an active player can start in a weekly league", () => {
    const active = planned(
      planAssignments({
        gamesPlayed: [],
        league: league(),
        roster: roster([
          member("bye", "QB", "QB", ["QB"], "not-scheduled"),
          member("active", "QB", "BN", ["QB"], "will-play"),
        ]),
        values: values([
          ["bye", 9900, "not-scheduled"],
          ["active", 100, "will-play"],
        ]),
      }),
    );

    expect(active.assignments).toEqual([
      { providerPlayerKey: "bye", slot: "BN" },
      { providerPlayerKey: "active", slot: "QB" },
    ]);

    const allOnBye = planned(
      planAssignments({
        gamesPlayed: [],
        league: league(),
        roster: roster([
          member("bye-one", "QB", "QB", ["QB"], "not-scheduled"),
          member("bye-two", "QB", "BN", ["QB"], "not-scheduled"),
        ]),
        values: values([
          ["bye-one", 900, "not-scheduled"],
          ["bye-two", 800, "not-scheduled"],
        ]),
      }),
    );

    expect(allOnBye.assignments).toEqual([]);
  });

  it("produces the same plan on a second run over its own output", () => {
    const first = planned(
      planAssignments({
        gamesPlayed: [],
        league: league([
          { position: "QB", kind: "starting", count: 1, eligibility: ["QB"] },
          { position: "RB", kind: "starting", count: 1, eligibility: ["RB"] },
          { position: "BN", kind: "bench", count: 2, eligibility: [] },
        ]),
        roster: roster([
          member("p1", "QB", "QB", ["QB"]),
          member("p2", "RB", "RB", ["RB"]),
          member("p3", "QB", "BN", ["QB"]),
          member("p4", "RB", "BN", ["RB"]),
        ]),
        values: values([
          ["p1", 100],
          ["p2", 400],
          ["p3", 900],
          ["p4", 300],
        ]),
      }),
    );
    const current = roster([
      member("p1", "QB", "QB", ["QB"]),
      member("p2", "RB", "RB", ["RB"]),
      member("p3", "QB", "BN", ["QB"]),
      member("p4", "RB", "BN", ["RB"]),
    ]);
    const applied = applyAssignments(current, first.assignments);

    const second = planned(
      planAssignments({
        gamesPlayed: [],
        league: league([
          { position: "QB", kind: "starting", count: 1, eligibility: ["QB"] },
          { position: "RB", kind: "starting", count: 1, eligibility: ["RB"] },
          { position: "BN", kind: "bench", count: 2, eligibility: [] },
        ]),
        roster: applied,
        values: values([
          ["p1", 100],
          ["p2", 400],
          ["p3", 900],
          ["p4", 300],
        ]),
      }),
    );

    expect(first.assignments).toHaveLength(2);
    expect(second.assignments).toEqual([]);
  });

  it("moves a reserve player out and the player who cannot play in", () => {
    const result = planned(
      planAssignments({
        gamesPlayed: [],
        league: league([
          { position: "C", kind: "starting", count: 1, eligibility: ["C"] },
          { position: "IR", kind: "reserve", count: 1, eligibility: ["IR"] },
          { position: "BN", kind: "bench", count: 1, eligibility: [] },
        ]),
        roster: roster([
          member("hurt", "C", "C", ["C", "IR"], "will-not-play"),
          member("parked", "C", "IR", ["C", "IR"], "will-play"),
          member("backup", "C", "BN", ["C"], "will-play"),
        ]),
        values: values([
          ["hurt", 9000, "will-not-play"],
          ["parked", 900, "will-play"],
          ["backup", 100, "will-play"],
        ]),
      }),
    );

    expect(result.assignments).toEqual([
      { providerPlayerKey: "hurt", slot: "IR" },
      { providerPlayerKey: "parked", slot: "C" },
    ]);
  });

  it("lets published eligibility, not the injury code, decide reserve occupancy", () => {
    const result = planned(
      planAssignments({
        gamesPlayed: [],
        league: league([
          { position: "C", kind: "starting", count: 1, eligibility: ["C"] },
          { position: "IR", kind: "reserve", count: 1, eligibility: ["IR"] },
          { position: "BN", kind: "bench", count: 1, eligibility: [] },
        ]),
        roster: roster([
          member("incumbent", "C", "C", ["C", "IR"], "will-play"),
          member("better", "C", "BN", ["C"], "will-play"),
          member("hurt", "C", "IR", ["C"], "will-not-play"),
        ]),
        values: values([
          ["incumbent", 500, "will-play"],
          ["better", 900, "will-play"],
          ["hurt", 50, "will-not-play"],
        ]),
      }),
    );

    expect(result.assignments).toHaveLength(3);
    expect(result.assignments).toContainEqual({ providerPlayerKey: "better", slot: "C" });
    expect(result.assignments).toContainEqual({ providerPlayerKey: "hurt", slot: "BN" });
    expect(result.assignments).toContainEqual({ providerPlayerKey: "incumbent", slot: "IR" });
  });

  it("never places a player in a reserve list they are not published as eligible for", () => {
    const result = planned(
      planAssignments({
        gamesPlayed: [],
        league: league([
          { position: "C", kind: "starting", count: 1, eligibility: ["C"] },
          { position: "IR", kind: "reserve", count: 1, eligibility: ["IR"] },
          { position: "IR+", kind: "reserve", count: 1, eligibility: ["IR+"] },
          { position: "BN", kind: "bench", count: 1, eligibility: [] },
        ]),
        roster: roster([
          member("hurt", "C", "C", ["C", "IR+"], "will-not-play"),
          member("parked", "C", "IR", ["C", "IR"], "will-play"),
          member("backup", "C", "BN", ["C"], "will-play"),
        ]),
        values: values([
          ["hurt", 9000, "will-not-play"],
          ["parked", 900, "will-play"],
          ["backup", 100, "will-play"],
        ]),
      }),
    );

    expect(result.assignments).toEqual([
      { providerPlayerKey: "hurt", slot: "IR+" },
      { providerPlayerKey: "parked", slot: "C" },
    ]);
  });

  it("moves a player out of a reserve list they are no longer eligible for", () => {
    const result = planned(
      planAssignments({
        gamesPlayed: [],
        league: league([
          { position: "C", kind: "starting", count: 1, eligibility: ["C"] },
          { position: "IR", kind: "reserve", count: 1, eligibility: ["IR"] },
          { position: "BN", kind: "bench", count: 1, eligibility: [] },
        ]),
        roster: roster([member("p1", "C", "C", ["C"]), member("p2", "C", "IR", ["C"])]),
        values: values([
          ["p1", 900],
          ["p2", 100],
        ]),
      }),
    );

    expect(result.assignments).toEqual([{ providerPlayerKey: "p2", slot: "BN" }]);
  });

  it("benches a displaced player the reserve list does not accept", () => {
    const result = planned(
      planAssignments({
        gamesPlayed: [],
        league: league([
          { position: "C", kind: "starting", count: 1, eligibility: ["C"] },
          { position: "IR", kind: "reserve", count: 1, eligibility: ["IR"] },
          { position: "BN", kind: "bench", count: 1, eligibility: [] },
        ]),
        roster: roster([
          member("hurt", "C", "C", ["C"], "will-not-play"),
          member("healthy", "C", "BN", ["C"]),
        ]),
        values: values([
          ["hurt", 9000, "will-not-play"],
          ["healthy", 100, "will-play"],
        ]),
      }),
    );

    expect(result.assignments).toEqual([
      { providerPlayerKey: "hurt", slot: "BN" },
      { providerPlayerKey: "healthy", slot: "C" },
    ]);
  });

  it("plans reserve moves in both directions without refusing", () => {
    const pool = league([
      { position: "C", kind: "starting", count: 1, eligibility: ["C"] },
      { position: "IR", kind: "reserve", count: 1, eligibility: ["IR"] },
      { position: "IR+", kind: "reserve", count: 1, eligibility: ["IR+"] },
      { position: "BN", kind: "bench", count: 2, eligibility: [] },
    ]);
    const candidates: ReadonlyArray<ReadonlyArray<ProviderRoster["players"][number]>> = [
      [
        member("hurt", "C", "C", ["C", "IR"], "will-not-play"),
        member("parked", "C", "IR", ["C", "IR"], "will-play"),
        member("backup", "C", "BN", ["C"], "will-play"),
      ],
      [
        member("incumbent", "C", "C", ["C", "IR+"], "will-play"),
        member("better", "C", "BN", ["C"], "will-play"),
        member("hurt", "C", "IR+", ["C"], "will-not-play"),
      ],
      [
        member("stale", "C", "IR", ["C"], "will-play"),
        member("starter", "C", "C", ["C"], "will-play"),
      ],
      [
        member("idle", "C", "C", ["C", "IR"], "not-scheduled"),
        member("playing", "C", "BN", ["C", "IR+"], "will-play"),
        member("parked", "C", "IR+", ["C", "IR+"], "will-not-play"),
        member("spare", "C", "BN", ["C"], "will-play"),
      ],
    ];

    for (const players of candidates) {
      const result = planAssignments({
        gamesPlayed: [],
        league: pool,
        roster: roster(players),
        values: values(
          players.map((player, index) => [
            player.providerPlayerKey,
            (index + 1) * 100,
            player.injuryCode === "O" ? "will-not-play" : "will-play",
          ]),
        ),
      });

      expect(result.kind).toBe("planned");
    }
  });

  it("reduces a position's starting capacity when its projection exceeds the allowance", () => {
    const games = league([
      { position: "C", kind: "starting", count: 2, eligibility: ["C"] },
      { position: "BN", kind: "bench", count: 3, eligibility: [] },
    ]);
    const members = roster([
      member("c1", "C", "C", ["C"]),
      member("c2", "C", "C", ["C"]),
      member("c3", "C", "BN", ["C"]),
      member("c4", "C", "BN", ["C"]),
    ]);
    const scores = values([
      ["c1", 400],
      ["c2", 300],
      ["c3", 200],
      ["c4", 100],
    ]);

    expect(
      planned(
        planAssignments({
          gamesPlayed: [],
          league: games,
          roster: members,
          values: scores,
        }),
      ).assignments,
    ).toEqual([]);
    expect(
      planned(
        planAssignments({
          league: games,
          roster: members,
          values: scores,
          gamesPlayed: [{ position: "C", played: 100, max: 162, projected: 165 }],
        }),
      ).assignments,
    ).toEqual([{ providerPlayerKey: "c2", slot: "BN" }]);
  });

  it("does not start a position whose maximum is already reached", () => {
    const games = league([
      { position: "C", kind: "starting", count: 1, eligibility: ["C"] },
      { position: "BN", kind: "bench", count: 3, eligibility: [] },
    ]);
    const result = planned(
      planAssignments({
        league: games,
        roster: roster([
          member("c1", "C", "C", ["C"]),
          member("c2", "C", "BN", ["C"]),
          member("c3", "C", "BN", ["C"]),
        ]),
        values: values([
          ["c1", 400],
          ["c2", 300],
          ["c3", 200],
        ]),
        gamesPlayed: [{ position: "C", played: 162, max: 162, projected: 170 }],
      }),
    );

    expect(result.assignments).toEqual([{ providerPlayerKey: "c1", slot: "BN" }]);
  });

  it("refuses when a required starting slot has no eligible player", () => {
    const result = planAssignments({
      gamesPlayed: [],
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
      gamesPlayed: [],
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
        gamesPlayed: [],
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
      gamesPlayed: [],
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
    currentDate: undefined,
    teamCount: 10,
    format: "head_to_head_points",
    scoringType: "head",
    scoringLabel: "H2H",
    weeklyDeadline: undefined,
    waiverType: undefined,
    waiverRule: undefined,
    usesFaab: undefined,
    waiverDays: undefined,
    maxWeeklyAcquisitions: undefined,
    maxSeasonAcquisitions: undefined,
    tradeEndDate: undefined,
    tradeRatification: undefined,
    tradeObjectionDays: undefined,
    draftStatus: undefined,
    periodWindow: { current: 3, start: 1, end: 17 },
    rosterCoverage: "week",
    maxGamesPlayed: undefined,
    maxInningsPitched: undefined,
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
  availability: ProviderAvailabilityTier = "will-play",
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
    scheduled: availability !== "not-scheduled",
    startingLineup: "unconfirmed",
    undroppable: null,
  };
}

function values(
  scores: ReadonlyArray<readonly [string, number | null, ProviderAvailabilityTier?]>,
): ReadonlyArray<ProviderPlayerScore> {
  return scores.map(([providerPlayerKey, score, availability]) => ({
    providerPlayerKey,
    score,
    availability: availability ?? "will-play",
  }));
}

function applyAssignments(
  current: ProviderRoster,
  assignments: ReadonlyArray<{ readonly providerPlayerKey: string; readonly slot: string }>,
): ProviderRoster {
  const slots = new Map(assignments.map((entry) => [entry.providerPlayerKey, entry.slot]));
  return {
    ...current,
    players: current.players.map((player) => ({
      ...player,
      slot: slots.get(player.providerPlayerKey) ?? player.slot,
    })),
  };
}
