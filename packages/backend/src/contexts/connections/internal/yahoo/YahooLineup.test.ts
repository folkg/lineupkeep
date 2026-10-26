import { makePlayerId, makeSlotId } from "@lineupkeep/lineup-solver";
import type { PlayerId, RosterSlot } from "@lineupkeep/lineup-solver";
import { describe, expect, it } from "vitest";

import type {
  ProviderLeagueSettings,
  ProviderPlayerDetail,
  ProviderRoster,
  ProviderRosterPlayer,
} from "#contexts/connections/Provider.ts";

import {
  planYahooLineup,
  yahooAssignmentRequest,
  yahooAvailability,
  yahooLeagueSlots,
  yahooObservationWindow,
  yahooPolicyInput,
  yahooScorable,
  yahooScoringProfile,
  yahooTargetPeriod,
} from "./YahooLineup.ts";
import type { YahooLineupInput } from "./YahooLineup.ts";

const recordedWeek = 6;
const targetWeek = 7;

describe("Yahoo league translation", () => {
  it("derives the league's scoring profile and reports its modifier coverage", () => {
    const profile = yahooScoringProfile(recordedLeague());

    expect(profile.scale).toBe(2);
    expect(profile.rules).toHaveLength(33);
    expect(profile.categories).toHaveLength(36);
  });

  it("models starting, bench, and reserve slots from the declared roster positions", () => {
    const slots = yahooLeagueSlots(recordedLeague());

    expect(slots.map(describeSlot)).toEqual([
      "starting QB x1 [QB] required",
      "starting RB x2 [RB] required",
      "starting WR x2 [WR] required",
      "starting TE x1 [TE] required",
      "starting W/R/T x1 [W/R/T] required",
      "starting K x1 [K] required",
      "starting DEF x1 [DEF] required",
      "bench BN x6 any",
      "reserve IR x1 [IR]",
    ]);
  });

  it("maps provider availability codes to named conditions", () => {
    expect(yahooAvailability(undefined)).toEqual({ kind: "available" });
    expect(yahooAvailability("O")).toEqual({ kind: "excluded", reason: "out" });
    expect(yahooAvailability("IR")).toEqual({ kind: "excluded", reason: "injured-reserve" });
    expect(yahooAvailability("IR-LT")).toEqual({ kind: "excluded", reason: "injured-reserve" });
    expect(yahooAvailability("SUSP")).toEqual({ kind: "excluded", reason: "suspended" });
    expect(yahooAvailability("NA")).toEqual({ kind: "excluded", reason: "not-active" });
    expect(yahooAvailability("DTD")).toEqual({ kind: "uncertain", reason: "day-to-day" });
    expect(yahooAvailability("PROBABLE")).toEqual({ kind: "unknown", code: "PROBABLE" });
  });

  it("reads the lineup period from the roster's own coverage", () => {
    expect(yahooTargetPeriod(recordedRoster(false))).toEqual({ kind: "week", week: targetWeek });

    const dated = recordedRoster(false, {
      coverage: { type: "date", date: "2026-10-26" },
    });
    expect(yahooTargetPeriod(dated)).toEqual({ kind: "date", date: "2026-10-26" });
  });

  it("declares one selection basis for the observed window", () => {
    const input = yahooPolicyInput(recordedPolicyInput(true));

    expect(input.selectionBasis).toBe(
      `yahoo:mean-points-per-period:week:${String(targetWeek - 1)}`,
    );
    expect(input.window).toEqual([{ kind: "week", week: targetWeek - 1 }]);
    expect(input.players).toHaveLength(15);
  });

  it("keeps the recorded lineup when the provider reports every player locked", () => {
    const result = planYahooLineup(recordedPolicyInput(false));

    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") {
      throw new Error("Expected a plan.");
    }
    expect(result.plan.totalSelectionValue).toBe(7332);
    expect(result.plan.comparison.slotChanges).toEqual([]);
    expect(result.selectionBasis).toBe("yahoo:mean-points-per-period:week:6");
    expect(new Set(result.coverage.scored).size).toBe(33);
    expect(result.coverage.unscored).toEqual(["8", "31", "78"]);
    expect(result.coverage.unusedRules).toEqual([]);
  });

  it("starts the better players when the same roster is editable", () => {
    const result = planYahooLineup(recordedPolicyInput(true));

    if (result.kind !== "planned") {
      throw new Error(`Expected a plan, received ${result.refusal.kind}.`);
    }
    expect(result.plan.totalSelectionValue).toBe(9002);
    expect(new Set(result.plan.comparison.addedStarters)).toEqual(
      new Set([7, 11].map(recordedPlayerId)),
    );
    expect(new Set(result.plan.comparison.removedStarters)).toEqual(
      new Set([2, 3].map(recordedPlayerId)),
    );
  });

  it("refuses a league that publishes categories without points modifiers", () => {
    const result = planYahooLineup({
      league: hockeyLeague(),
      roster: hockeyRoster(),
      history: [{ period: { kind: "date", date: "2026-10-25" }, details: [] }],
    });

    expect(result).toEqual({
      kind: "refused",
      refusal: { kind: "policy", refusal: { kind: "no-scoring-rules" } },
    });
  });

  it("translates only the changed editable assignments and retains every roster member", () => {
    const parsed = planYahooLineup(recordedPolicyInput(true));
    if (parsed.kind !== "planned") {
      throw new Error("Expected a plan.");
    }

    const result = yahooAssignmentRequest({
      league: recordedLeague(),
      roster: recordedRoster(true),
      plan: parsed.plan,
    });

    expect(result.kind).toBe("request");
    if (result.kind !== "request") {
      throw new Error("Expected a request.");
    }
    const currentSlots = new Map(
      recordedRoster(true).players.map((player) => [player.providerPlayerKey, player.slot]),
    );
    expect(result.assignments).toHaveLength(parsed.plan.comparison.slotChanges.length);
    expect(new Set(result.assignments.map((assignment) => assignment.playerKey)).size).toBe(
      result.assignments.length,
    );
    for (const assignment of result.assignments) {
      expect(currentSlots.has(assignment.playerKey)).toBe(true);
      expect(currentSlots.get(assignment.playerKey)).not.toBe(assignment.slot);
    }
  });

  it("sends nothing when the plan already matches the observed lineup", () => {
    const parsed = planYahooLineup(recordedPolicyInput(false));
    if (parsed.kind !== "planned") {
      throw new Error("Expected a plan.");
    }

    expect(
      yahooAssignmentRequest({
        league: recordedLeague(),
        roster: recordedRoster(false),
        plan: parsed.plan,
      }),
    ).toEqual({ kind: "no_op" });
  });

  it("refuses to move a player the provider reports as locked", () => {
    const parsed = planYahooLineup(recordedPolicyInput(true));
    if (parsed.kind !== "planned") {
      throw new Error("Expected a plan.");
    }

    const result = yahooAssignmentRequest({
      league: recordedLeague(),
      roster: recordedRoster(false),
      plan: parsed.plan,
    });

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") {
      throw new Error("Expected a refusal.");
    }
    expect(result.refusal.kind).toBe("locked-player");
  });

  it("refuses a plan that moves a player through a reserve list", () => {
    const parsed = planYahooLineup(recordedPolicyInput(true));
    if (parsed.kind !== "planned") {
      throw new Error("Expected a plan.");
    }
    const plan = {
      ...parsed.plan,
      assignments: parsed.plan.assignments.map((assignment) =>
        assignment.playerId === recordedPlayerId(7)
          ? { ...assignment, slotId: makeSlotId("IR") }
          : assignment,
      ),
    };

    const result = yahooAssignmentRequest({
      league: recordedLeague(),
      roster: recordedRoster(true),
      plan,
    });

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") {
      throw new Error("Expected a refusal.");
    }
    expect(result.refusal.kind).toBe("reserve-list");
  });

  it("refuses a plan that does not assign every roster member", () => {
    const parsed = planYahooLineup(recordedPolicyInput(true));
    if (parsed.kind !== "planned") {
      throw new Error("Expected a plan.");
    }
    const plan = {
      ...parsed.plan,
      assignments: parsed.plan.assignments.slice(1),
    };

    const result = yahooAssignmentRequest({
      league: recordedLeague(),
      roster: recordedRoster(true),
      plan,
    });

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") {
      throw new Error("Expected a refusal.");
    }
    expect(result.refusal.kind).toBe("plan-membership");
  });

  it("derives the completed observation window from the target period", () => {
    expect(yahooObservationWindow(recordedLeague(), recordedRoster(true))).toEqual([
      { kind: "week", week: 3 },
      { kind: "week", week: 4 },
      { kind: "week", week: 5 },
      { kind: "week", week: 6 },
    ]);
    expect(yahooScorable(recordedLeague())).toBe(true);
    expect(yahooScorable(hockeyLeague())).toBe(false);
  });
});

function describeSlot(slot: RosterSlot): string {
  const eligibility =
    slot.eligibility.kind === "any" ? "any" : `[${slot.eligibility.positions.join(",")}]`;
  const requirement = slot.kind === "starting" ? ` ${slot.requirement}` : "";
  return `${slot.kind} ${slot.id} x${String(slot.capacity)} ${eligibility}${requirement}`;
}

function recordedPlayerId(index: number): PlayerId {
  return makePlayerId(`player-${String(index)}`);
}

function recordedPolicyInput(editable: boolean): YahooLineupInput {
  return {
    league: recordedLeague(),
    roster: recordedRoster(editable),
    history: [
      {
        period: { kind: "week" as const, week: recordedWeek },
        details: recordedRosterRows.map((row, index) => playerDetail(index, row.slot, row.stats)),
      },
    ],
  };
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
    scoringType: "head",
    scoringLabel: "Head-to-Head",
    weeklyDeadline: undefined,
    waiverType: "continual_rolling",
    waiverRule: undefined,
    usesFaab: false,
    draftStatus: "postdraft",
    periodWindow: { currentWeek: targetWeek, startWeek: 1, endWeek: 17 },
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
    isFlex: null,
    isEditable: editable,
    injuryCode: row.injuryCode,
    injuryDetail: undefined,
    byeWeek: row.byeWeek,
    undroppable: null,
  };
}

function playerDetail(
  index: number,
  slot: string,
  stats: ReadonlyArray<readonly [number, number]>,
): ProviderPlayerDetail {
  return {
    providerPlayerKey: `player-${String(index)}`,
    name: `Player ${String(index)}`,
    primaryPosition: slot,
    displayPosition: slot,
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
    scoringType: "head",
    scoringLabel: "Head-to-Head",
    weeklyDeadline: "",
    waiverType: "continual_rolling",
    waiverRule: undefined,
    usesFaab: false,
    draftStatus: "postdraft",
    periodWindow: { currentWeek: 5, startWeek: 1, endWeek: 26 },
    rosterCoverage: "date",
    rosterPositions: [
      position("C", 2, true),
      position("LW", 2, true),
      position("RW", 2, true),
      position("D", 4, true),
      position("G", 2, true),
      position("BN", 7, false),
      position("IR", 2, false),
      position("IR+", 1, false),
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
      {
        providerPlayerKey: "hockey-player-0",
        name: "Hockey player 0",
        displayPosition: "C,LW",
        primaryPosition: "C",
        positionType: "P",
        proTeamAbbreviation: undefined,
        eligiblePositions: ["C", "LW"],
        slot: "C",
        isFlex: false,
        isEditable: true,
        injuryCode: undefined,
        injuryDetail: undefined,
        byeWeek: null,
        undroppable: null,
      },
    ],
  };
}

function position(
  positionName: string,
  count: number,
  isStarting: boolean,
): ProviderLeagueSettings["rosterPositions"][number] {
  return { position: positionName, positionType: undefined, count, isStarting };
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
): RecordedRow {
  return { slot, eligiblePositions, injuryCode, byeWeek, isEditable, stats };
}

type RecordedRow = {
  readonly slot: string;
  readonly eligiblePositions: ReadonlyArray<string>;
  readonly injuryCode: string | undefined;
  readonly byeWeek: number;
  readonly isEditable: boolean;
  readonly stats: ReadonlyArray<readonly [number, number]>;
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
  position("QB", 1, true),
  position("RB", 2, true),
  position("WR", 2, true),
  position("TE", 1, true),
  position("W/R/T", 1, true),
  position("K", 1, true),
  position("DEF", 1, true),
  position("BN", 6, false),
  position("IR", 1, false),
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
