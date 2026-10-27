import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import type {
  PlayerAvailability,
  PolicyPlayer,
} from "#contexts/connections/internal/provider-scoring/types.ts";
import { assessAvailability } from "#contexts/connections/internal/provider-scoring/Valuation.ts";
import { LineupTargetPeriod } from "#contexts/connections/LineupRun.ts";
import type {
  ProviderLeagueSettings,
  ProviderLineupOutcome,
  ProviderLineupRequest,
  ProviderRoster,
  ProviderRosterPlayer,
} from "#contexts/connections/Provider.ts";
import type { ProviderPlayerDetail } from "#contexts/connections/Provider.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";

import {
  planYahooLineup,
  yahooAvailability,
  yahooCapabilities,
  yahooInjuryStatusCodes,
  yahooObservationWindow,
  yahooScoringProfile,
  yahooTargetPeriod,
} from "./YahooLineup.ts";
import type { YahooLineupReader, YahooPeriodHistory, YahooStartRate } from "./YahooLineup.ts";

const recordedWeek = 6;
const targetWeek = 7;

describe("Yahoo scoring translation", () => {
  it("derives the league's scoring profile and reports its modifier coverage", () => {
    const profile = yahooScoringProfile(recordedLeague());

    expect(profile.scale).toBe(2);
    expect(profile.rules).toHaveLength(33);
    expect(profile.categories).toHaveLength(36);
  });

  it("maps every provider status code to exactly one availability tier", () => {
    const tiers = yahooInjuryStatusCodes.map(
      (code) =>
        assessAvailability(policyPlayerWith(yahooAvailability(code)), {
          kind: "week",
          week: targetWeek,
        }).tier,
    );

    expect(new Set(tiers)).toEqual(new Set(["might-play", "will-not-play"]));
    expect(tiers).toHaveLength(yahooInjuryStatusCodes.length);
    expect(
      assessAvailability(policyPlayerWith(yahooAvailability(undefined)), {
        kind: "week",
        week: targetWeek,
      }).tier,
    ).toBe("will-play");
    expect(
      assessAvailability(policyPlayerWith(yahooAvailability("PUP-2027")), {
        kind: "week",
        week: targetWeek,
      }).tier,
    ).toBe("might-play");
  });

  it("treats a bye in the target period as an absence, not a low score", () => {
    const onBye = yahooAvailability(undefined);
    const assessment = assessAvailability(
      { ...policyPlayerWith(onBye), nonGamePeriods: [{ kind: "week", week: targetWeek }] },
      { kind: "week", week: targetWeek },
    );

    expect(assessment).toEqual({
      tier: "will-not-play",
      fact: "no-game",
      period: { kind: "week", week: targetWeek },
    });
  });

  it("reads the lineup period from the roster's own coverage", () => {
    expect(yahooTargetPeriod(recordedRoster(true))).toEqual({ kind: "week", week: targetWeek });
    expect(
      yahooTargetPeriod({
        ...recordedRoster(true),
        coverage: { type: "date", date: "2026-10-26" },
      }),
    ).toEqual({ kind: "date", date: "2026-10-26" });
  });

  it("derives the completed observation window from the target period", () => {
    expect(yahooObservationWindow(recordedLeague(), { kind: "week", week: targetWeek })).toEqual([
      { kind: "week", week: 3 },
      { kind: "week", week: 4 },
      { kind: "week", week: 5 },
      { kind: "week", week: 6 },
    ]);
    expect(yahooObservationWindow(recordedLeague(), { kind: "date", date: "2026-10-26" })).toEqual([
      { kind: "date", date: "2026-10-22" },
      { kind: "date", date: "2026-10-23" },
      { kind: "date", date: "2026-10-24" },
      { kind: "date", date: "2026-10-25" },
    ]);
  });

  it("declares the search capability it can honour without a scoring declaration", () => {
    expect(yahooCapabilities.publishesProjections).toBe(false);
    expect(yahooCapabilities.playerSearch.weeklyStatSortSports).toEqual(["football"]);
    expect(yahooCapabilities.sports).toEqual(["football", "hockey"]);
  });

  it("publishes one final score per player from the league's own rules", () => {
    const outcome = runPlan(recordedRequest(), {
      rates: [],
      history: [
        {
          period: { kind: "week", week: recordedWeek },
          details: recordedRosterRows.map((row, index) => playerDetail(index, row.stats)),
        },
      ],
    });

    expect(outcome.kind).toBe("scored");
    if (outcome.kind !== "scored") {
      throw new Error("Expected scored values.");
    }
    expect(outcome.provenance).toBe("yahoo/mean-points-per-period:week:3,week:4,week:5,week:6");
    expect(outcome.players).toHaveLength(recordedRosterRows.length);
    expect(outcome.players[0]).toEqual({
      providerPlayerKey: "player-0",
      score: 1702,
      availability: "will-play",
    });
    expect(outcome.players[2]?.availability).toBe("will-not-play");
  });

  it("publishes one final score per player from the started percentage", () => {
    const outcome = runPlan(hockeyRequest(), {
      rates: [
        startRate("hockey-player-0", 43, [{ cut: "diamond", percent: 51 }]),
        startRate("hockey-player-1", 12, [{ cut: "diamond", percent: 8 }]),
      ],
    });

    expect(outcome.kind).toBe("scored");
    if (outcome.kind !== "scored") {
      throw new Error("Expected scored values.");
    }
    expect(outcome.provenance).toBe("yahoo/community-start-rate:cut-diamond:date:2026-10-26");
    expect(outcome.players).toEqual([
      { providerPlayerKey: "hockey-player-0", score: 5100, availability: "will-play" },
      { providerPlayerKey: "hockey-player-1", score: 800, availability: "will-play" },
    ]);
  });

  it("leaves a player unscored when the provider publishes no started percentage", () => {
    const outcome = runPlan(hockeyRequest(), {
      rates: [startRate("hockey-player-0", 43, [])],
    });

    expect(outcome.kind).toBe("scored");
    if (outcome.kind !== "scored") {
      throw new Error("Expected scored values.");
    }
    expect(outcome.players).toEqual([
      { providerPlayerKey: "hockey-player-0", score: 4300, availability: "will-play" },
      { providerPlayerKey: "hockey-player-1", score: null, availability: "will-play" },
    ]);
  });

  it("falls through to the started percentage when no period has been completed", () => {
    const outcome = runPlan(
      { ...recordedRequest(), target: weekTarget(1) },
      { rates: [startRate("player-0", 44, [])] },
    );

    expect(outcome.kind).toBe("scored");
    if (outcome.kind !== "scored") {
      throw new Error("Expected scored values.");
    }
    expect(outcome.provenance).toBe("yahoo/community-start-rate:overall:week:1");
    expect(outcome.players.map((player) => player.score)).toEqual([
      4400,
      ...recordedRosterRows.slice(1).map(() => null),
    ]);
  });
});

const hockeyTarget = Schema.decodeSync(LineupTargetPeriod)({
  coverage: "date",
  date: "2026-10-26",
});

function hockeyRequest(): ProviderLineupRequest {
  return {
    provider: decodeProviderKey("yahoo"),
    session: Redacted.make("recorded-session"),
    providerTeamKey: "recorded-hockey-team",
    providerLeagueKey: "recorded-hockey-league",
    sport: "hockey",
    league: hockeyLeague(),
    roster: hockeyRoster(),
    target: hockeyTarget,
  };
}

function recordedRequest(): ProviderLineupRequest {
  return {
    provider: decodeProviderKey("yahoo"),
    session: Redacted.make("recorded-session"),
    providerTeamKey: "recorded-team",
    providerLeagueKey: "recorded-league",
    sport: "football",
    league: recordedLeague(),
    roster: recordedRoster(true),
    target: { coverage: "week", week: targetWeek },
  };
}

function runPlan(
  request: ProviderLineupRequest,
  facts: {
    readonly rates: ReadonlyArray<YahooStartRate>;
    readonly history?: ReadonlyArray<YahooPeriodHistory>;
  },
): ProviderLineupOutcome {
  const history = facts.history ?? [];
  const reader: YahooLineupReader = {
    readStartRates: () => Effect.succeed(facts.rates),
    readHistory: () => Effect.succeed(history),
  };
  return Effect.runSync(planYahooLineup(request, reader));
}

function startRate(
  providerPlayerKey: string,
  percent: number,
  cuts: ReadonlyArray<{ readonly cut: string; readonly percent: number }>,
): YahooStartRate {
  return {
    providerPlayerKey,
    percent,
    change: null,
    coverage: { type: "date", date: "2026-10-26" },
    cuts,
  };
}

function weekTarget(week: number): ProviderLineupRequest["target"] {
  return Schema.decodeSync(LineupTargetPeriod)({ coverage: "week", week });
}

function policyPlayerWith(availability: PlayerAvailability): PolicyPlayer {
  return { id: "recorded-player", availability, nonGamePeriods: [] };
}

function recordedLeague(): ProviderLeagueSettings {
  return {
    providerLeagueKey: "recorded-league",
    name: "Recorded league",
    webUrl: "https://football.fantasysports.yahoo.com/f1/recorded",
    season: 2026,
    startDate: "2026-09-01",
    endDate: "2026-12-29",
    teamCount: 12,
    format: "head_to_head_points",
    scoringType: "head",
    scoringLabel: "Head-to-Head",
    weeklyDeadline: undefined,
    waiverType: "continual_rolling",
    waiverRule: undefined,
    usesFaab: false,
    draftStatus: "postdraft",
    periodWindow: { current: targetWeek, start: 1, end: 17 },
    rosterCoverage: "week",
    rosterPositions: recordedRosterPositions,
    statCategories: recordedCategories,
    statModifiers: recordedStatModifiers,
  };
}

function recordedRoster(
  editable: boolean,
  options: { readonly coverage?: ProviderRoster["coverage"] } = {},
): ProviderRoster {
  return {
    providerTeamKey: "recorded-team",
    providerLeagueKey: "recorded-league",
    coverage: options.coverage ?? { type: "week", week: targetWeek },
    players: recordedRosterRows.map((row, index) => rosterPlayer(index, row, editable)),
  };
}

function rosterPlayer(index: number, row: RecordedRow, editable: boolean): ProviderRosterPlayer {
  return {
    providerPlayerKey: `player-${String(index)}`,
    name: `Player ${String(index)}`,
    displayPosition: row.eligiblePositions[0] ?? row.slot,
    primaryPosition: row.eligiblePositions[0] ?? row.slot,
    positionType: undefined,
    proTeamAbbreviation: undefined,
    eligiblePositions: row.eligiblePositions,
    slot: row.slot,
    isEditable: editable,
    injuryCode: row.injuryCode,
    injuryDetail: undefined,
    byeWeek: row.byeWeek,
    scheduled: row.scheduled,
    undroppable: null,
  };
}

function playerDetail(
  index: number,
  stats: ReadonlyArray<readonly [number, number]>,
): ProviderPlayerDetail {
  return {
    providerPlayerKey: `player-${String(index)}`,
    name: `Player ${String(index)}`,
    primaryPosition: recordedRosterRows[index]?.slot ?? "",
    displayPosition: recordedRosterRows[index]?.slot ?? "",
    eligiblePositions: undefined,
    rosterStatus: "rostered",
    actual: {
      basis: { type: "week", week: recordedWeek },
      stats: stats.map(([statId, value]) => ({ statId, value })),
    },
    projected: undefined,
  };
}

function hockeyLeague(): ProviderLeagueSettings {
  return {
    providerLeagueKey: "recorded-hockey-league",
    name: "Recorded hockey league",
    webUrl: "https://hockey.fantasysports.yahoo.com/hockey/recorded",
    season: 2026,
    startDate: "2026-10-01",
    endDate: "2027-04-10",
    teamCount: 12,
    format: "head_to_head_categories",
    scoringType: "head",
    scoringLabel: "Head-to-Head",
    weeklyDeadline: "",
    waiverType: "continual_rolling",
    waiverRule: undefined,
    usesFaab: false,
    draftStatus: "postdraft",
    periodWindow: { current: 5, start: 1, end: 26 },
    rosterCoverage: "date",
    rosterPositions: [
      position("C", 2),
      position("LW", 2),
      position("RW", 2),
      position("D", 4),
      position("G", 2),
      position("BN", 7),
      position("IR", 2),
      position("IR+", 1),
    ],
    statCategories: [
      category(1, "Goals", "G"),
      category(2, "Assists", "A"),
      category(25, "Saves", "SV"),
    ],
    statModifiers: [],
  };
}

function hockeyRoster(): ProviderRoster {
  return {
    providerTeamKey: "recorded-hockey-team",
    providerLeagueKey: "recorded-hockey-league",
    coverage: { type: "date", date: "2026-10-26" },
    players: [
      hockeyRosterPlayer("hockey-player-0", "C"),
      hockeyRosterPlayer("hockey-player-1", "BN"),
    ],
  };
}

function hockeyRosterPlayer(providerPlayerKey: string, slot: string): ProviderRosterPlayer {
  return {
    providerPlayerKey,
    name: `Synthetic hockey player ${providerPlayerKey.slice("hockey-player-".length)}`,
    displayPosition: "C",
    primaryPosition: "C",
    positionType: "P",
    proTeamAbbreviation: undefined,
    eligiblePositions: ["C"],
    slot,
    isEditable: true,
    injuryCode: undefined,
    injuryDetail: undefined,
    byeWeek: null,
    scheduled: true,
    undroppable: null,
  };
}

function position(
  positionName: string,
  count: number,
): ProviderLeagueSettings["rosterPositions"][number] {
  const kind =
    positionName === "BN" ? "bench" : positionName.startsWith("IR") ? "reserve" : "starting";
  return {
    position: positionName,
    positionType: undefined,
    kind,
    count,
    eligibility: kind === "bench" ? [] : [positionName],
  };
}

function category(
  statId: number,
  name: string,
  abbreviation: string,
): ProviderLeagueSettings["statCategories"][number] {
  return {
    statId,
    name,
    displayName: name,
    abbreviation,
    group: "",
    enabled: true,
    positionTypes: [] as ReadonlyArray<string>,
  };
}

function player(
  slot: string,
  eligiblePositions: ReadonlyArray<string>,
  injuryCode: string | undefined,
  byeWeek: number,
  isEditable: boolean,
  stats: ReadonlyArray<readonly [number, number]>,
  scheduled = true,
): RecordedRow {
  return { slot, eligiblePositions, injuryCode, byeWeek, isEditable, stats, scheduled };
}

type RecordedRow = {
  readonly slot: string;
  readonly eligiblePositions: ReadonlyArray<string>;
  readonly injuryCode: string | undefined;
  readonly byeWeek: number;
  readonly isEditable: boolean;
  readonly stats: ReadonlyArray<readonly [number, number]>;
  readonly scheduled: boolean;
};

const recordedStatModifiers: ReadonlyArray<{ statId: number; points: string }> = [
  { statId: 4, points: "0.04" },
  { statId: 5, points: "4" },
  { statId: 6, points: "-1" },
  { statId: 9, points: "0.1" },
  { statId: 10, points: "6" },
  { statId: 11, points: "1" },
  { statId: 12, points: "0.1" },
  { statId: 13, points: "6" },
  { statId: 15, points: "6" },
  { statId: 16, points: "2" },
  { statId: 18, points: "-2" },
  { statId: 57, points: "6" },
  { statId: 19, points: "3" },
  { statId: 20, points: "3" },
  { statId: 21, points: "3" },
  { statId: 22, points: "4" },
  { statId: 23, points: "5" },
  { statId: 29, points: "1" },
  { statId: 32, points: "1" },
  { statId: 33, points: "2" },
  { statId: 34, points: "2" },
  { statId: 35, points: "6" },
  { statId: 36, points: "2" },
  { statId: 37, points: "2" },
  { statId: 49, points: "6" },
  { statId: 50, points: "10" },
  { statId: 51, points: "7" },
  { statId: 52, points: "4" },
  { statId: 53, points: "1" },
  { statId: 54, points: "0" },
  { statId: 55, points: "-1" },
  { statId: 56, points: "-4" },
  { statId: 82, points: "2" },
];

const recordedCategories: ReadonlyArray<ReturnType<typeof category>> = [
  category(4, "Passing Yards", "Yds"),
  category(5, "Passing Touchdowns", "TD"),
  category(6, "Interceptions", "Int"),
  category(8, "Rushing Attempts", "Att"),
  category(9, "Rushing Yards", "Yds"),
  category(10, "Rushing Touchdowns", "TD"),
  category(78, "Targets", "Targets"),
  category(11, "Receptions", "Rec"),
  category(12, "Receiving Yards", "Yds"),
  category(13, "Receiving Touchdowns", "TD"),
  category(15, "Return Touchdowns", "TD"),
  category(16, "2-Point Conversions", "2-PT"),
  category(18, "Fumbles Lost", "Lost"),
  category(57, "Offensive Fumble Return TD", "Off Fumb TD"),
  category(19, "Field Goals 0-19 Yards", "0-19 Yds"),
  category(20, "Field Goals 20-29 Yards", "20-29 Yds"),
  category(21, "Field Goals 30-39 Yards", "30-39 Yds"),
  category(22, "Field Goals 40-49 Yards", "40-49 Yds"),
  category(23, "Field Goals 50+ Yards", "50+ Yds"),
  category(29, "Point After Attempt Made", "Made"),
  category(31, "Points Allowed", "Pts vs."),
  category(32, "Sack", "Sack"),
  category(33, "Interception", "Int"),
  category(34, "Fumble Recovery", "Fum Rec"),
  category(35, "Touchdown", "TD"),
  category(36, "Safety", "Safe"),
  category(37, "Block Kick", "Blk Kick"),
  category(49, "Kickoff and Punt Return Touchdowns", "TD"),
  category(50, "Points Allowed 0 points", "0 Pts"),
  category(51, "Points Allowed 1-6 points", "1-6 Pts"),
  category(52, "Points Allowed 7-13 points", "7-13 Pts"),
  category(53, "Points Allowed 14-20 points", "14-20 Pts"),
  category(54, "Points Allowed 21-27 points", "21-27 Pts"),
  category(55, "Points Allowed 28-34 points", "28-34 Pts"),
  category(56, "Points Allowed 35+ points", "35+ Pts"),
  category(82, "Extra Point Returned", "XPR"),
];

const recordedRosterPositions: ReadonlyArray<ReturnType<typeof position>> = [
  position("QB", 1),
  position("RB", 2),
  position("WR", 2),
  position("TE", 1),
  position("W/R/T", 1),
  position("K", 1),
  position("DEF", 1),
  position("BN", 6),
  position("IR", 1),
];

const recordedRosterRows: ReadonlyArray<ReturnType<typeof player>> = [
  player("QB", ["QB"], undefined, 9, false, [
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
  ]),
  player("RB", ["RB", "W/R/T"], undefined, 10, false, [
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
  ]),
  player("RB", ["RB", "W/R/T"], undefined, 7, false, [
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
  ]),
  player("WR", ["WR", "W/R/T"], undefined, 11, false, [
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
  ]),
  player("WR", ["WR", "W/R/T"], undefined, 11, false, [
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
  ]),
  player("TE", ["TE", "W/R/T"], undefined, 11, false, [
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
  ]),
  player("W/R/T", ["WR", "W/R/T"], undefined, 8, false, [
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
  ]),
  player("BN", ["WR", "W/R/T"], undefined, 5, false, [
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
  ]),
  player("BN", ["RB", "W/R/T"], undefined, 11, false, [
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
  ]),
  player("BN", ["WR", "W/R/T"], undefined, 10, false, [
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
  ]),
  player("BN", ["WR", "W/R/T", "IR"], "IR", 13, false, [
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
  ]),
  player("BN", ["RB", "W/R/T"], undefined, 10, false, [
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
  ]),
  player("BN", ["WR", "W/R/T"], undefined, 7, false, [
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
  ]),
  player("K", ["K"], undefined, 11, false, [
    [19, 0],
    [20, 0],
    [21, 0],
    [22, 0],
    [23, 0],
    [29, 1],
  ]),
  player("DEF", ["DEF"], undefined, 11, false, [
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
  ]),
];
