import {
  availabilityLadder,
  assessAvailability,
  buildLineupProblem,
  lineupAssignments,
  planLineup,
} from "@lineupkeep/lineup-policy";
import type { PlayerAvailability, PolicyPlayer } from "@lineupkeep/lineup-policy";
import { makeAvailabilityTier, makePlayerId, makeSlotId } from "@lineupkeep/lineup-solver";
import type { PlayerId, RosterSlot } from "@lineupkeep/lineup-solver";
import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { LineupTargetPeriod } from "#contexts/connections/LineupRun.ts";
import type {
  ProviderLeagueSettings,
  ProviderLineupOutcome,
  ProviderLineupRequest,
  ProviderPlayerDetail,
  ProviderRoster,
  ProviderRosterPlayer,
} from "#contexts/connections/Provider.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";

import {
  planYahooLineup,
  yahooAvailability,
  yahooCapabilities,
  yahooCommunityStartRatePolicyInput,
  yahooInjuryStatusCodes,
  yahooLeagueSlots,
  yahooObservationWindow,
  yahooPointsPolicyInput,
  yahooScoringProfile,
  yahooTargetPeriod,
} from "./YahooLineup.ts";
import type { YahooPeriodHistory } from "./YahooLineup.ts";

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
    expect(yahooLeagueSlots(recordedLeague()).map(describeSlot)).toEqual([
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

  it("maps every provider status code to exactly one availability tier", () => {
    const period = yahooTargetPeriod(recordedRoster(true));
    const codes = [undefined, ...yahooInjuryStatusCodes, "PROBABLE", "Q", ""];
    const tiers = codes.map(
      (code) => assessAvailability(policyPlayerWith(yahooAvailability(code)), period).tier,
    );

    expect(tiers.every((tier) => availabilityLadder.includes(makeAvailabilityTier(tier)))).toBe(
      true,
    );
    expect(new Set(tiers)).toEqual(new Set(["will-play", "might-play", "will-not-play"]));
  });

  it("maps provider availability codes to named conditions", () => {
    expect(yahooAvailability(undefined)).toEqual({ kind: "available" });
    expect(yahooAvailability("O")).toEqual({ kind: "excluded", reason: "out" });
    expect(yahooAvailability("IR")).toEqual({ kind: "excluded", reason: "injured-reserve" });
    expect(yahooAvailability("IR-LT")).toEqual({ kind: "excluded", reason: "injured-reserve" });
    expect(yahooAvailability("SUSP")).toEqual({ kind: "excluded", reason: "suspended" });
    expect(yahooAvailability("NA")).toEqual({ kind: "excluded", reason: "not-active" });
    expect(yahooAvailability("DTD")).toEqual({ kind: "uncertain", reason: "day-to-day" });
    expect(yahooAvailability("PROBABLE")).toEqual({ kind: "unrecognised", code: "PROBABLE" });
    expect(yahooAvailability("")).toEqual({ kind: "unrecognised", code: "" });
  });

  it("reads the lineup period from the roster's own coverage", () => {
    expect(yahooTargetPeriod(recordedRoster(false))).toEqual({ kind: "week", week: targetWeek });

    const dated = recordedRoster(false, {
      coverage: { type: "date", date: "2026-10-26" },
    });
    expect(yahooTargetPeriod(dated)).toEqual({ kind: "date", date: "2026-10-26" });
  });

  it("declares the league's selection basis from the observed window", () => {
    const input = yahooPointsPolicyInput(recordedPolicyFacts());

    expect(input.period).toEqual({ kind: "week", week: targetWeek });
    expect(input.source?.kind).toBe("scoring-rules");
    expect(input.players).toHaveLength(15);
  });

  it("keeps the recorded lineup when the provider reports every player locked", () => {
    const result = planLineup([yahooPointsPolicyInput(recordedPolicyFacts(false))]);

    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") {
      throw new Error("Expected a plan.");
    }
    expect(result.plan.totalSelectionValue).toBe(9802);
    expect(result.plan.comparison.slotChanges).toEqual([]);
    expect(result.basis).toBe("mean-points-per-period:week:3,week:4,week:5,week:6");
  });

  it("starts the better players when the same roster is editable", () => {
    const result = planLineup([yahooPointsPolicyInput(recordedPolicyFacts(true))]);

    if (result.kind !== "planned") {
      throw new Error(`Expected a plan, received ${result.refusals[0]?.code ?? "no refusal"}.`);
    }
    expect(result.plan.totalSelectionValue).toBe(9002);
    expect(new Set(result.plan.comparison.addedStarters)).toEqual(
      new Set([7, 11].map(recordedPlayerId)),
    );
    expect(new Set(result.plan.comparison.removedStarters)).toEqual(
      new Set([2, 3].map(recordedPlayerId)),
    );
  });

  it("declares which value sources the provider publishes", () => {
    expect(yahooCapabilities.publishesProjections).toBe(false);
    expect(yahooCapabilities.publishesCommunityStartRate).toBe(true);
    expect(yahooCapabilities.playerSearch.weeklyStatSortSports).toEqual(["football"]);
  });

  it("values a hockey roster by the community start rate the provider publishes", () => {
    const input = yahooCommunityStartRatePolicyInput({
      league: hockeyLeague(),
      roster: hockeyRoster(),
      details: [
        hockeyDetail("hockey-player-0", 43, [{ cut: "diamond", percent: 51 }]),
        hockeyDetail("hockey-player-1", 12, [{ cut: "diamond", percent: 8 }]),
      ],
    });
    const verdict = buildLineupProblem(input);

    if (verdict.kind !== "problem") {
      throw new Error(`Expected a problem, received ${verdict.refusal.kind}.`);
    }
    expect(verdict.problem.selectionBasis).toBe("community-start-rate:cut-diamond:date:2026-10-26");
    expect(verdict.valuations.map((valuation) => valuation.selection)).toEqual([
      {
        kind: "known",
        basis: "community-start-rate:cut-diamond:date:2026-10-26",
        units: 5100,
      },
      {
        kind: "known",
        basis: "community-start-rate:cut-diamond:date:2026-10-26",
        units: 800,
      },
    ]);
  });

  it("benches a roster player the provider publishes no community start rate for", () => {
    const policyInput = yahooCommunityStartRatePolicyInput({
      league: {
        ...hockeyLeague(),
        rosterPositions: [position("C", 1), position("BN", 2)],
      },
      roster: hockeyRoster(),
      details: [hockeyDetail("hockey-player-0", 43, [])],
    });
    const planned = planLineup([policyInput]);

    if (planned.kind !== "planned") {
      throw new Error(`Expected a plan, received ${planned.refusals[0]?.code ?? "no refusal"}.`);
    }
    expect(planned.valuations[1]?.selection).toEqual({
      kind: "unusable",
      basis: "community-start-rate:overall:date:2026-10-26",
      reason: "missing",
    });
    expect(planned.plan.assignments).toContainEqual({
      playerId: makePlayerId("hockey-player-1"),
      slotId: makeSlotId("BN"),
    });
    expect(planned.plan.comparison.addedStarters).toEqual([]);
    expect(planned.plan.comparison.removedStarters).toEqual([]);
    expect(planned.plan.totalSelectionValue).toBe(4300);
  });

  it("translates only the changed editable assignments and retains every roster member", () => {
    const planned = planLineup([yahooPointsPolicyInput(recordedPolicyFacts(true))]);
    if (planned.kind !== "planned") {
      throw new Error("Expected a plan.");
    }

    const result = translate(recordedLeague(), recordedRoster(true), planned.plan);

    expect(result.kind).toBe("request");
    if (result.kind !== "request") {
      throw new Error("Expected a request.");
    }
    const currentSlots = new Map(
      recordedRoster(true).players.map((player) => [player.providerPlayerKey, player.slot]),
    );
    expect(result.assignments).toHaveLength(planned.plan.comparison.slotChanges.length);
    expect(new Set(result.assignments.map((assignment) => assignment.playerKey)).size).toBe(
      result.assignments.length,
    );
    for (const assignment of result.assignments) {
      expect(currentSlots.has(assignment.playerKey)).toBe(true);
      expect(currentSlots.get(assignment.playerKey)).not.toBe(assignment.slot);
    }
  });

  it("sends nothing when the plan already matches the observed lineup", () => {
    const planned = planLineup([yahooPointsPolicyInput(recordedPolicyFacts(false))]);
    if (planned.kind !== "planned") {
      throw new Error("Expected a plan.");
    }

    expect(translate(recordedLeague(), recordedRoster(false), planned.plan)).toEqual({
      kind: "request",
      assignments: [],
    });
  });

  it("refuses to move a player the provider reports as locked", () => {
    const planned = planLineup([yahooPointsPolicyInput(recordedPolicyFacts(true))]);
    if (planned.kind !== "planned") {
      throw new Error("Expected a plan.");
    }

    const result = translate(recordedLeague(), recordedRoster(false), planned.plan);

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") {
      throw new Error("Expected a refusal.");
    }
    expect(result.code).toBe("assignment:locked-player");
  });

  it("refuses a plan that moves a player through a reserve list", () => {
    const planned = planLineup([yahooPointsPolicyInput(recordedPolicyFacts(true))]);
    if (planned.kind !== "planned") {
      throw new Error("Expected a plan.");
    }
    const plan = {
      ...planned.plan,
      assignments: planned.plan.assignments.map((assignment) =>
        assignment.playerId === recordedPlayerId(7)
          ? { ...assignment, slotId: makeSlotId("IR") }
          : assignment,
      ),
    };

    const result = translate(recordedLeague(), recordedRoster(true), plan);

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") {
      throw new Error("Expected a refusal.");
    }
    expect(result.code).toBe("assignment:reserve-slot");
  });

  it("refuses a plan that does not assign every roster member", () => {
    const planned = planLineup([yahooPointsPolicyInput(recordedPolicyFacts(true))]);
    if (planned.kind !== "planned") {
      throw new Error("Expected a plan.");
    }
    const plan = {
      ...planned.plan,
      assignments: planned.plan.assignments.slice(1),
    };

    const result = translate(recordedLeague(), recordedRoster(true), plan);

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") {
      throw new Error("Expected a refusal.");
    }
    expect(result.code).toBe("assignment:plan-membership");
  });

  it("plans through the provider capability and reports a named native refusal", () => {
    const unfillable = runPlan(
      hockeyRequest(),
      [hockeyDetail("hockey-player-0", 43, []), hockeyDetail("hockey-player-1", 12, [])],
      [],
    );
    expect(unfillable.kind).toBe("refused");
    if (unfillable.kind !== "refused") {
      throw new Error("Expected a refusal.");
    }
    expect(unfillable.action).toBe("native");
    expect(unfillable.code).toBe("solver:required-starting-position-unfillable");

    const fromRules = runPlan(
      recordedRequest(),
      recordedPolicyFacts()
        .history.map((entry) => entry.details)
        .flat(),
      recordedPolicyFacts().history,
    );
    expect(fromRules.kind).toBe("planned");
    if (fromRules.kind !== "planned") {
      throw new Error("Expected a plan.");
    }
    expect(fromRules.basis).toBe("mean-points-per-period:week:3,week:4,week:5,week:6");
    expect(fromRules.assignments).toHaveLength(4);
  });

  it("derives the completed observation window from the target period", () => {
    expect(yahooObservationWindow(recordedLeague(), { kind: "week", week: targetWeek })).toEqual([
      { kind: "week", week: 3 },
      { kind: "week", week: 4 },
      { kind: "week", week: 5 },
      { kind: "week", week: 6 },
    ]);
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

function recordedPolicyFacts(editable = true): {
  readonly league: ProviderLeagueSettings;
  readonly roster: ProviderRoster;
  readonly history: ReadonlyArray<YahooPeriodHistory>;
} {
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
  details: ReadonlyArray<ProviderPlayerDetail>,
  history: ReadonlyArray<YahooPeriodHistory>,
): ProviderLineupOutcome {
  return Effect.runSync(
    planYahooLineup(request, {
      readDetails: () => Effect.succeed(details),
      readHistory: () => Effect.succeed(history),
    }),
  );
}

function translate(
  league: ProviderLeagueSettings,
  roster: ProviderRoster,
  plan: Parameters<typeof lineupAssignments>[0]["plan"],
): ReturnType<typeof lineupAssignments> {
  const slots = yahooLeagueSlots(league);
  return lineupAssignments({
    plan,
    slots: slots.map((slot) => ({ id: slot.id, kind: slot.kind })),
    players: roster.players.map((player) => ({
      playerKey: player.providerPlayerKey,
      name: player.name,
      slot: player.slot,
      editable: player.isEditable === true,
    })),
  });
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
    communityStartRate: undefined,
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
    isFlex: false,
    isEditable: true,
    injuryCode: undefined,
    injuryDetail: undefined,
    byeWeek: null,
    undroppable: null,
  };
}

function hockeyDetail(
  providerPlayerKey: string,
  percent: number,
  cuts: ReadonlyArray<{ readonly cut: string; readonly percent: number }>,
): ProviderPlayerDetail {
  return {
    providerPlayerKey,
    name: undefined,
    primaryPosition: "C",
    displayPosition: "C",
    eligiblePositions: ["C"],
    rosterStatus: "rostered",
    actual: undefined,
    projected: undefined,
    communityStartRate: {
      percent,
      change: null,
      coverage: { type: "date", date: "2026-10-26" },
      cuts: cuts.map((cut) => ({ cut: cut.cut, percent: cut.percent })),
    },
  };
}

function policyPlayerWith(availability: PlayerAvailability): PolicyPlayer {
  return {
    id: makePlayerId("recorded-player"),
    eligiblePositions: ["QB"],
    availability,
    locked: false,
    currentSlotId: makeSlotId("QB"),
    nonGamePeriods: [],
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
