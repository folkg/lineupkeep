import { Effect, Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { FantasySport } from "#contexts/connections/FantasyTeam.ts";
import { planAssignments } from "#contexts/connections/internal/LineupPlanning.ts";
import type { PlanAssignmentsResult } from "#contexts/connections/internal/LineupPlanning.ts";
import type {
  PlayerAvailability,
  PolicyPlayer,
  RankType,
} from "#contexts/connections/internal/provider-scoring/types.ts";
import { assessAvailability } from "#contexts/connections/internal/provider-scoring/Valuation.ts";
import { LineupTargetPeriod } from "#contexts/connections/LineupRun.ts";
import type {
  ProviderLeagueSettings,
  ProviderLineupOutcome,
  ProviderLineupRequest,
  ProviderRoster,
  ProviderRosterPlayer,
  ProviderStartingLineup,
} from "#contexts/connections/Provider.ts";
import type { ProviderPlayerDetail } from "#contexts/connections/Provider.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";

import {
  planYahooLineup,
  yahooAvailability,
  yahooCapabilities,
  yahooDefaultStartingLineupRole,
  yahooInjuryStatusCodes,
  yahooObservationWindow,
  yahooScoringProfile,
  yahooStartingLineupRole,
  yahooStartingLineupRoleBySport,
  yahooStartingLineupRule,
  yahooStartingLineupRuleByRole,
  yahooStatusReserveListed,
  yahooTargetPeriod,
} from "./YahooLineup.ts";
import type { YahooLineupReader, YahooPeriodHistory, YahooPlayerFacts } from "./YahooLineup.ts";

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

    expect(tiers).toHaveLength(yahooInjuryStatusCodes.length);
    expect(new Set(yahooInjuryStatusCodes)).toEqual(
      new Set(["healthy", "O", "IR", "IR+", "IR-LT", "NA", "SUSP", "D", "DTD", "Q", "P", "GTD"]),
    );
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
      }),
    ).toEqual({ tier: "might-play", fact: "unrecognised-status", code: "PUP-2027" });
  });

  it("reads the status table as two facts per code", () => {
    const table = yahooInjuryStatusCodes.map((code) => [
      code,
      assessAvailability(policyPlayerWith(yahooAvailability(code)), {
        kind: "week",
        week: targetWeek,
      }).tier,
      yahooStatusReserveListed(code),
    ]);

    expect(table).toEqual([
      ["healthy", "will-play", false],
      ["O", "will-not-play", true],
      ["IR", "will-not-play", true],
      ["IR+", "will-not-play", true],
      ["IR-LT", "will-not-play", true],
      ["NA", "will-not-play", true],
      ["SUSP", "will-not-play", true],
      ["D", "might-play", false],
      ["DTD", "might-play", false],
      ["Q", "might-play", false],
      ["P", "might-play", false],
      ["GTD", "might-play", false],
    ]);
  });

  it("records which uncertain code produced the doubtful tier", () => {
    const assessment = assessAvailability(policyPlayerWith(yahooAvailability("Q")), {
      kind: "week",
      week: targetWeek,
    });

    expect(assessment).toEqual({ tier: "might-play", fact: "uncertain-status", code: "Q" });
  });

  it("treats a bye in the target period as an absence, not a low score", () => {
    const onBye = yahooAvailability(undefined);
    const assessment = assessAvailability(
      { ...policyPlayerWith(onBye), nonGamePeriods: [{ kind: "week", week: targetWeek }] },
      { kind: "week", week: targetWeek },
    );

    expect(assessment).toEqual({
      tier: "not-scheduled",
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
    expect(outcome.players[2]?.availability).toBe("not-scheduled");
  });

  it("publishes one final score per player from the started percentage", () => {
    const outcome = runPlan(hockeyRequest(), {
      rates: [
        startRate("hockey-player-0", 43, [{ cut: "platinum", percent: 51 }]),
        startRate("hockey-player-1", 12, [{ cut: "platinum", percent: 8 }]),
      ],
    });

    expect(outcome.kind).toBe("scored");
    if (outcome.kind !== "scored") {
      throw new Error("Expected scored values.");
    }
    expect(outcome.provenance).toBe("yahoo/community-start-rate:cut-platinum:date:2026-10-26");
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
    expect(outcome.provenance).toBe(
      "yahoo/community-start-rate:overall:platinum-cut-incomplete:week:1",
    );
    expect(outcome.players.map((player) => player.score)).toEqual([
      4400,
      ...recordedRosterRows.slice(1).map(() => null),
    ]);
  });

  it("tiers a player whose team is not playing at the bottom rung with the no-game fact", () => {
    const period = { kind: "date" as const, date: "2026-10-26" };

    expect(
      assessAvailability({ ...policyPlayerWith(yahooAvailability("O")), scheduled: false }, period),
    ).toEqual({ tier: "not-scheduled", fact: "no-game", period });
    expect(
      assessAvailability(
        { ...policyPlayerWith(yahooAvailability(undefined)), scheduled: false },
        period,
      ).tier,
    ).toBe("not-scheduled");
  });

  it("starts the player who has a game ahead of a higher-scoring player who does not", () => {
    const roster = centerRoster([
      { key: "idle", slot: "C", scheduled: false },
      { key: "playing", slot: "BN", scheduled: true },
    ]);

    const { outcome, decision } = planCenters(roster, [
      ["idle", 47],
      ["playing", 13],
    ]);

    expect(outcome.players).toEqual([
      { providerPlayerKey: "idle", score: 4700, availability: "not-scheduled" },
      { providerPlayerKey: "playing", score: 1300, availability: "will-play" },
    ]);
    expect(planned(decision).assignments).toEqual([
      { providerPlayerKey: "idle", slot: "BN" },
      { providerPlayerKey: "playing", slot: "C" },
    ]);
  });

  it("never starts a player without a game over one who has a game, whatever their scores", () => {
    const roster = centerRoster([
      { key: "idle", slot: "C", scheduled: false },
      { key: "playing", slot: "BN", scheduled: true },
    ]);

    for (const [idlePercent, playingPercent] of [
      [99, 1],
      [50, 50],
      [0, 0],
    ] as const) {
      const { decision } = planCenters(roster, [
        ["idle", idlePercent],
        ["playing", playingPercent],
      ]);

      expect(planned(decision).assignments).toContainEqual({
        providerPlayerKey: "playing",
        slot: "C",
      });
    }
  });

  it("tiers a confirmed real-world start above an unconfirmed player who will play", () => {
    const period = { kind: "date" as const, date: "2026-10-26" };

    expect(
      assessAvailability(
        { ...policyPlayerWith(yahooAvailability(undefined)), startingLineup: "confirmed-starting" },
        period,
      ),
    ).toEqual({ tier: "confirmed-start", fact: "confirmed-start" });
    expect(
      assessAvailability(
        { ...policyPlayerWith(yahooAvailability(undefined)), startingLineup: "unconfirmed" },
        period,
      ).tier,
    ).toBe("will-play");
  });

  it("places a confirmed non-starter who cannot appear below an unconfirmed player who might", () => {
    const period = { kind: "date" as const, date: "2026-10-26" };

    expect(
      assessAvailability(
        {
          ...policyPlayerWith(yahooAvailability(undefined)),
          startingLineup: "confirmed-not-starting",
          startingLineupRule: "unlikely-to-play",
        },
        period,
      ),
    ).toEqual({ tier: "unlikely-to-play", fact: "confirmed-not-starting" });
    expect(
      assessAvailability(
        {
          ...policyPlayerWith(yahooAvailability(undefined)),
          startingLineup: "confirmed-not-starting",
          startingLineupRule: "not-an-availability-fact",
        },
        period,
      ).tier,
    ).toBe("will-play");
  });

  it("keeps an injury status above the starting-lineup refinement", () => {
    const period = { kind: "date" as const, date: "2026-10-26" };

    expect(
      assessAvailability(
        { ...policyPlayerWith(yahooAvailability("O")), startingLineup: "confirmed-starting" },
        period,
      ).tier,
    ).toBe("will-not-play");
    expect(
      assessAvailability(
        { ...policyPlayerWith(yahooAvailability("Q")), startingLineup: "confirmed-starting" },
        period,
      ).tier,
    ).toBe("might-play");
    expect(
      assessAvailability(
        {
          ...policyPlayerWith(yahooAvailability("O")),
          startingLineup: "confirmed-not-starting",
          startingLineupRule: "unlikely-to-play",
        },
        period,
      ).tier,
    ).toBe("will-not-play");
  });

  it("starts the confirmed starter ahead of an unconfirmed player of equal score", () => {
    const roster = centerRoster([
      { key: "unconfirmed", slot: "C", scheduled: true },
      { key: "confirmed", slot: "BN", scheduled: true, startingLineup: "confirmed-starting" },
    ]);

    const { outcome, decision } = planCenters(roster, [
      ["unconfirmed", 40],
      ["confirmed", 40],
    ]);

    expect(outcome.players).toEqual([
      { providerPlayerKey: "unconfirmed", score: 4000, availability: "will-play" },
      { providerPlayerKey: "confirmed", score: 4000, availability: "confirmed-start" },
    ]);
    expect(planned(decision).assignments).toEqual([
      { providerPlayerKey: "unconfirmed", slot: "BN" },
      { providerPlayerKey: "confirmed", slot: "C" },
    ]);
  });

  it("keeps a confirmed starter who is out below a healthy player", () => {
    const roster = centerRoster([
      {
        key: "confirmed-out",
        slot: "C",
        scheduled: true,
        startingLineup: "confirmed-starting",
        injuryCode: "O",
      },
      { key: "healthy", slot: "BN", scheduled: true },
    ]);

    const { decision } = planCenters(roster, [
      ["confirmed-out", 90],
      ["healthy", 5],
    ]);

    expect(planned(decision).assignments).toEqual([
      { providerPlayerKey: "confirmed-out", slot: "BN" },
      { providerPlayerKey: "healthy", slot: "C" },
    ]);
  });

  it("starts an unconfirmed goalie ahead of a confirmed backup whatever the scores", () => {
    const roster = goalieRoster([
      { key: "backup", slot: "G", scheduled: true, startingLineup: "confirmed-not-starting" },
      { key: "unconfirmed", slot: "G", scheduled: true },
      { key: "starter", slot: "BN", scheduled: true, startingLineup: "confirmed-starting" },
    ]);

    const { outcome, decision } = planGoalies(roster, [
      ["backup", 90],
      ["unconfirmed", 5],
      ["starter", 1],
    ]);

    expect(outcome.players).toEqual([
      { providerPlayerKey: "backup", score: 9000, availability: "unlikely-to-play" },
      { providerPlayerKey: "unconfirmed", score: 500, availability: "will-play" },
      { providerPlayerKey: "starter", score: 100, availability: "confirmed-start" },
    ]);
    expect(planned(decision).assignments).toEqual([
      { providerPlayerKey: "backup", slot: "BN" },
      { providerPlayerKey: "starter", slot: "G" },
    ]);
  });

  it("keeps a goalie's score when only their starting-lineup fact changes", () => {
    const facts = (startingLineup: ProviderStartingLineup): ProviderRoster =>
      goalieRoster([
        { key: "goalie", slot: "G", scheduled: true, startingLineup },
        { key: "other", slot: "G", scheduled: true },
      ]);

    const percents = [
      ["goalie", 55],
      ["other", 45],
    ] as const;

    expect(planGoalies(facts("confirmed-not-starting"), percents).outcome.players[0]?.score).toBe(
      planGoalies(facts("confirmed-starting"), percents).outcome.players[0]?.score,
    );
  });

  it("fills a required goalie slot from a confirmed backup when every other goalie has no game", () => {
    const roster = goalieRoster([
      { key: "backup", slot: "BN", scheduled: true, startingLineup: "confirmed-not-starting" },
      { key: "idle", slot: "G", scheduled: false },
    ]);

    const { decision } = planGoalies(
      roster,
      [
        ["backup", 1],
        ["idle", 99],
      ],
      1,
    );

    expect(planned(decision).assignments).toEqual([
      { providerPlayerKey: "backup", slot: "G" },
      { providerPlayerKey: "idle", slot: "BN" },
    ]);
  });

  it("keeps an injured-out player below a confirmed backup goalie", () => {
    const roster = goalieRoster([
      { key: "out", slot: "G", scheduled: true, injuryCode: "O" },
      { key: "backup", slot: "BN", scheduled: true, startingLineup: "confirmed-not-starting" },
    ]);

    const { decision } = planGoalies(
      roster,
      [
        ["out", 99],
        ["backup", 1],
      ],
      1,
    );

    expect(planned(decision).assignments).toEqual([
      { providerPlayerKey: "out", slot: "BN" },
      { providerPlayerKey: "backup", slot: "G" },
    ]);
  });

  it("keeps a doubtful goalie above one who is confirmed not starting", () => {
    const roster = goalieRoster([
      { key: "doubtful", slot: "G", scheduled: true, injuryCode: "DTD" },
      { key: "backup", slot: "BN", scheduled: true, startingLineup: "confirmed-not-starting" },
    ]);

    const { decision } = planGoalies(
      roster,
      [
        ["doubtful", 1],
        ["backup", 99],
      ],
      1,
    );

    expect(planned(decision).assignments).toEqual([]);
  });

  it("does not demote a skater who is outside their real team's starting lineup", () => {
    const roster = centerRoster([
      {
        key: "not-starting",
        slot: "BN",
        scheduled: true,
        startingLineup: "confirmed-not-starting",
      },
      { key: "unconfirmed", slot: "C", scheduled: true },
    ]);

    const { outcome, decision } = planCenters(roster, [
      ["not-starting", 90],
      ["unconfirmed", 5],
    ]);

    expect(outcome.players.map((player) => player.availability)).toEqual([
      "will-play",
      "will-play",
    ]);
    expect(planned(decision).assignments).toEqual([
      { providerPlayerKey: "not-starting", slot: "C" },
      { providerPlayerKey: "unconfirmed", slot: "BN" },
    ]);
  });

  it("declares how a confirmed non-start is read for every sport and position class", () => {
    const sports: ReadonlyArray<FantasySport> = ["football", "hockey", "baseball", "basketball"];

    expect(Object.keys(yahooStartingLineupRoleBySport).sort()).toEqual([...sports].sort());
    expect(yahooCapabilities.sports).toEqual(["football", "hockey"]);

    for (const sport of sports) {
      const roles = yahooStartingLineupRoleBySport[sport];
      expect(Object.keys(roles).length).toBeGreaterThan(0);
      for (const [position, role] of Object.entries(roles)) {
        expect(yahooStartingLineupRole(sport, position)).toBe(role);
        expect(yahooStartingLineupRule(sport, position)).toBe(yahooStartingLineupRuleByRole[role]);
      }
    }

    expect(yahooStartingLineupRuleByRole).toEqual({
      goalie: "unlikely-to-play",
      "starting-pitcher": "unlikely-to-play",
      "relief-pitcher": "not-an-availability-fact",
      "position-player": "not-an-availability-fact",
    });
    expect(yahooStartingLineupRole("hockey", "G")).toBe("goalie");
    expect(yahooStartingLineupRole("baseball", "SP")).toBe("starting-pitcher");
    expect(yahooStartingLineupRole("baseball", "RP")).toBe("relief-pitcher");
    expect(yahooStartingLineupRole("baseball", "P")).toBe("relief-pitcher");
    expect(yahooStartingLineupRole("baseball", "OF")).toBe("position-player");
    expect(yahooStartingLineupRole("football", "QB")).toBe("position-player");
    expect(yahooStartingLineupRole("basketball", "PG")).toBe("position-player");
    expect(yahooDefaultStartingLineupRole).toBe("position-player");
    expect(yahooStartingLineupRole("hockey", "undeclared")).toBe(yahooDefaultStartingLineupRole);
    expect(yahooStartingLineupRule("hockey", "undeclared")).toBe("not-an-availability-fact");
  });

  it("refuses to plan a sport the adapter does not publish", () => {
    const outcome = runPlan({ ...hockeyRequest(), sport: "baseball" }, { rates: [] });

    expect(outcome).toEqual({
      kind: "refused",
      refusal: "structural",
      provenance: "yahoo/unsupported-sport",
      detail: "This provider does not plan lineups for this sport.",
    });
  });

  it("does not demote a football player who is outside the starting lineup", () => {
    const roster = recordedRoster(true);
    const rotated = {
      ...roster,
      players: roster.players.map((player, index) =>
        index === 3 ? { ...player, startingLineup: "confirmed-not-starting" as const } : player,
      ),
    };
    const outcome = runPlan(
      { ...recordedRequest(), roster: rotated },
      {
        rates: [],
        history: [
          {
            period: { kind: "week", week: recordedWeek },
            details: recordedRosterRows.map((row, index) => playerDetail(index, row.stats)),
          },
        ],
      },
    );

    expect(outcome.kind).toBe("scored");
    if (outcome.kind !== "scored") {
      throw new Error("Expected scored values.");
    }
    expect(outcome.players[3]?.availability).toBe("will-play");
  });

  it("prices a games-limited league from percent owned and ranks, not the crowd", () => {
    const league = gamesLimitedLeague();
    const roster = centerRoster([
      { key: "crowd", slot: "C", scheduled: true },
      { key: "owned", slot: "BN", scheduled: true },
    ]);

    const outcome = runPlan(
      { ...hockeyRequest(), league, roster },
      {
        rates: [ownedFacts("owned", 80, [["PS7", 1]]), ownedFacts("crowd", 5, [["PS7", 30]])],
        gamesPlayed: [{ position: "C", played: 20, max: 82, projected: 20 }],
      },
    );

    expect(outcome.kind).toBe("scored");
    if (outcome.kind !== "scored") {
      return;
    }
    expect(outcome.provenance).toBe(
      "yahoo/ownership-composite:no-positional-scarcity:hockey:date:2026-10-26",
    );
    expect(outcome.players).toEqual([
      { providerPlayerKey: "crowd", score: 55000, availability: "will-play" },
      { providerPlayerKey: "owned", score: 450000, availability: "will-play" },
    ]);
    expect(
      planned(planAssignments({ league, roster, values: outcome.players })).assignments,
    ).toEqual([
      { providerPlayerKey: "crowd", slot: "BN" },
      { providerPlayerKey: "owned", slot: "C" },
    ]);
  });

  it("bounds the ownership delta adjustment", () => {
    const league = gamesLimitedLeague();
    const roster = centerRoster([{ key: "rising", slot: "C", scheduled: true }]);

    const outcome = runPlan(
      { ...hockeyRequest(), league, roster },
      {
        rates: [ownedFacts("rising", 10, [], 9)],
        gamesPlayed: [{ position: "C", played: 20, max: 82, projected: 20 }],
      },
    );

    expect(outcome.kind).toBe("scored");
    if (outcome.kind !== "scored") {
      return;
    }
    expect(outcome.players[0]?.score).toBe(90000);
  });

  it("ignores participation only when the position's projection exceeds its allowance", () => {
    const league = gamesLimitedLeague();
    const roster = centerRoster([
      { key: "idle", slot: "C", scheduled: false },
      { key: "playing", slot: "BN", scheduled: true },
    ]);
    const facts = {
      rates: [ownedFacts("idle", 90, [["PS7", 1]]), ownedFacts("playing", 10, [["PS7", 30]])],
    };

    const over = runPlan(
      { ...hockeyRequest(), league, roster },
      { ...facts, gamesPlayed: [{ position: "C", played: 70, max: 82, projected: 90 }] },
    );

    expect(over.kind).toBe("scored");
    if (over.kind !== "scored") {
      return;
    }
    expect(over.players).toEqual([
      { providerPlayerKey: "idle", score: 500000, availability: "will-play" },
      { providerPlayerKey: "playing", score: 80000, availability: "will-play" },
    ]);
    expect(planned(planAssignments({ league, roster, values: over.players })).assignments).toEqual(
      [],
    );

    const under = runPlan(
      { ...hockeyRequest(), league, roster },
      { ...facts, gamesPlayed: [{ position: "C", played: 70, max: 82, projected: 82 }] },
    );

    expect(under.kind).toBe("scored");
    if (under.kind !== "scored") {
      return;
    }
    expect(under.players.map((player) => player.availability)).toEqual([
      "not-scheduled",
      "will-play",
    ]);
    expect(planned(planAssignments({ league, roster, values: under.players })).assignments).toEqual(
      [
        { providerPlayerKey: "idle", slot: "BN" },
        { providerPlayerKey: "playing", slot: "C" },
      ],
    );
  });

  it("reads the allowance from an eligible position when the player's slot has none", () => {
    const league = gamesLimitedLeague();
    const roster = centerRoster([{ key: "idle", slot: "BN", scheduled: false }]);

    const outcome = runPlan(
      { ...hockeyRequest(), league, roster },
      {
        rates: [ownedFacts("idle", 90, [["PS7", 1]])],
        gamesPlayed: [{ position: "C", played: 70, max: 82, projected: 90 }],
      },
    );

    expect(outcome.kind).toBe("scored");
    if (outcome.kind !== "scored") {
      return;
    }
    expect(outcome.players[0]?.availability).toBe("will-play");
  });

  it("keeps participation when no games allowance is published", () => {
    const league = gamesLimitedLeague();
    const roster = centerRoster([{ key: "idle", slot: "BN", scheduled: false }]);

    const outcome = runPlan(
      { ...hockeyRequest(), league, roster },
      {
        rates: [ownedFacts("idle", 90, [["PS7", 1]])],
        gamesPlayed: [],
      },
    );

    expect(outcome.kind).toBe("scored");
    if (outcome.kind !== "scored") {
      return;
    }
    expect(outcome.players[0]?.availability).toBe("not-scheduled");
  });

  it("starts a reserve player who has a game and benches the displaced player", () => {
    const roster = centerRoster([
      { key: "hurt", slot: "C", scheduled: true, injuryCode: "O" },
      { key: "parked", slot: "IR", scheduled: true, eligiblePositions: ["C", "IR"] },
      { key: "backup", slot: "BN", scheduled: true },
    ]);

    const { decision } = planCenters(roster, [
      ["hurt", 50],
      ["parked", 30],
      ["backup", 10],
    ]);
    const plannedAssignments = planned(decision).assignments;

    expect(plannedAssignments).toEqual([
      { providerPlayerKey: "hurt", slot: "BN" },
      { providerPlayerKey: "parked", slot: "C" },
    ]);
    expect(plannedAssignments.every((assignment) => assignment.slot !== "IR")).toBe(true);
  });

  it("places every roster member exactly once", () => {
    const roster = centerRoster([
      { key: "idle", slot: "C", scheduled: false },
      { key: "playing", slot: "BN", scheduled: true },
      { key: "parked", slot: "IR", scheduled: true, eligiblePositions: ["C", "IR"] },
    ]);

    const { decision } = planCenters(roster, [
      ["idle", 47],
      ["playing", 13],
      ["parked", 5],
    ]);
    const finalSlots = new Map(
      roster.players.map((player) => [player.providerPlayerKey, player.slot]),
    );
    for (const assignment of planned(decision).assignments) {
      finalSlots.set(assignment.providerPlayerKey, assignment.slot);
    }

    expect(finalSlots.size).toBe(roster.players.length);
    expect([...finalSlots.values()]).toEqual(["BN", "C", "IR"]);
  });

  it("changes the plan exactly when a player without a game holds a slot a playing player could fill", () => {
    const percents = [
      ["idle", 47],
      ["playing", 13],
    ] as const;
    const hidden = centerRoster([
      { key: "idle", slot: "C", scheduled: true },
      { key: "playing", slot: "BN", scheduled: true },
    ]);
    const supplied = centerRoster([
      { key: "idle", slot: "C", scheduled: false },
      { key: "playing", slot: "BN", scheduled: true },
    ]);
    const benched = centerRoster([
      { key: "idle", slot: "BN", scheduled: false },
      { key: "playing", slot: "C", scheduled: true },
    ]);

    expect(planned(planCenters(hidden, percents).decision).assignments).toEqual([]);
    expect(planned(planCenters(supplied, percents).decision).assignments).toHaveLength(2);
    expect(planned(planCenters(benched, percents).decision).assignments).toEqual([]);
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
    readonly rates: ReadonlyArray<YahooPlayerFacts>;
    readonly history?: ReadonlyArray<YahooPeriodHistory>;
    readonly gamesPlayed?: ReadonlyArray<{
      readonly position: string;
      readonly played: number;
      readonly max: number;
      readonly projected: number;
    }>;
  },
): ProviderLineupOutcome {
  const history = facts.history ?? [];
  const reader: YahooLineupReader = {
    readPlayerFacts: () => Effect.succeed(facts.rates),
    readGamesPlayed: () => Effect.succeed(facts.gamesPlayed ?? []),
    readHistory: () => Effect.succeed(history),
  };
  return Effect.runSync(planYahooLineup(request, reader));
}

function startRate(
  providerPlayerKey: string,
  percent: number,
  cuts: ReadonlyArray<{ readonly cut: string; readonly percent: number }>,
): YahooPlayerFacts {
  return {
    providerPlayerKey,
    percent,
    change: null,
    coverage: { type: "date", date: "2026-10-26" },
    cuts,
    percentOwned: null,
    percentOwnedDelta: null,
    ranks: [],
  };
}

function gamesLimitedLeague(): ProviderLeagueSettings {
  return { ...centerLeague(), maxGamesPlayed: 82, maxInningsPitched: undefined };
}

function ownedFacts(
  providerPlayerKey: string,
  percentOwned: number,
  ranks: ReadonlyArray<readonly [RankType, number]> = [],
  delta = 0,
): YahooPlayerFacts {
  return {
    providerPlayerKey,
    percent: null,
    change: null,
    coverage: { type: "date", date: "2026-10-26" },
    cuts: [],
    percentOwned,
    percentOwnedDelta: delta,
    ranks: ranks.map(([type, rank]) => ({ type, rank })),
  };
}

function centerLeague(): ProviderLeagueSettings {
  return {
    ...hockeyLeague(),
    rosterPositions: [position("C", 1), position("BN", 2), position("IR", 1)],
  };
}

function goalieLeague(goalieSlots = 2): ProviderLeagueSettings {
  return {
    ...hockeyLeague(),
    rosterPositions: [position("G", goalieSlots), position("BN", 2), position("IR", 1)],
  };
}

function centerRoster(
  rows: ReadonlyArray<{
    readonly key: string;
    readonly slot: string;
    readonly scheduled: boolean;
    readonly startingLineup?: ProviderStartingLineup;
    readonly injuryCode?: string;
    readonly eligiblePositions?: ReadonlyArray<string>;
  }>,
): ProviderRoster {
  return hockeyRosterOf(rows, "C", "P");
}

function goalieRoster(
  rows: ReadonlyArray<{
    readonly key: string;
    readonly slot: string;
    readonly scheduled: boolean;
    readonly startingLineup?: ProviderStartingLineup;
    readonly injuryCode?: string;
  }>,
): ProviderRoster {
  return hockeyRosterOf(rows, "G", "G");
}

function hockeyRosterOf(
  rows: ReadonlyArray<{
    readonly key: string;
    readonly slot: string;
    readonly scheduled: boolean;
    readonly startingLineup?: ProviderStartingLineup;
    readonly injuryCode?: string;
    readonly eligiblePositions?: ReadonlyArray<string>;
  }>,
  primaryPosition: string,
  positionType: string,
): ProviderRoster {
  return {
    providerTeamKey: "recorded-hockey-team",
    providerLeagueKey: "recorded-hockey-league",
    coverage: { type: "date", date: "2026-10-26" },
    players: rows.map((row) => ({
      providerPlayerKey: row.key,
      name: row.key,
      displayPosition: primaryPosition,
      primaryPosition,
      positionType,
      proTeamAbbreviation: undefined,
      eligiblePositions: row.eligiblePositions ?? [primaryPosition],
      slot: row.slot,
      isEditable: true,
      injuryCode: row.injuryCode,
      injuryDetail: undefined,
      byeWeek: null,
      scheduled: row.scheduled,
      startingLineup: row.startingLineup ?? "unconfirmed",
      undroppable: null,
    })),
  };
}

function planCenters(
  roster: ProviderRoster,
  percents: ReadonlyArray<readonly [string, number]>,
): {
  readonly outcome: Extract<ProviderLineupOutcome, { kind: "scored" }>;
  readonly decision: PlanAssignmentsResult;
} {
  return planWithLeague(centerLeague(), roster, percents);
}

function planGoalies(
  roster: ProviderRoster,
  percents: ReadonlyArray<readonly [string, number]>,
  goalieSlots = 2,
): {
  readonly outcome: Extract<ProviderLineupOutcome, { kind: "scored" }>;
  readonly decision: PlanAssignmentsResult;
} {
  return planWithLeague(goalieLeague(goalieSlots), roster, percents);
}

function planWithLeague(
  league: ProviderLeagueSettings,
  roster: ProviderRoster,
  percents: ReadonlyArray<readonly [string, number]>,
): {
  readonly outcome: Extract<ProviderLineupOutcome, { kind: "scored" }>;
  readonly decision: PlanAssignmentsResult;
} {
  const outcome = runPlan(
    { ...hockeyRequest(), league, roster },
    { rates: percents.map(([key, percent]) => startRate(key, percent, [])) },
  );
  if (outcome.kind !== "scored") {
    throw new Error("Expected scored values.");
  }
  return { outcome, decision: planAssignments({ league, roster, values: outcome.players }) };
}

function planned(
  result: PlanAssignmentsResult,
): Extract<PlanAssignmentsResult, { kind: "planned" }> {
  if (result.kind !== "planned") {
    throw new Error(`Expected a plan, received ${result.detail}.`);
  }
  return result;
}

function weekTarget(week: number): ProviderLineupRequest["target"] {
  return Schema.decodeSync(LineupTargetPeriod)({ coverage: "week", week });
}

function policyPlayerWith(availability: PlayerAvailability): PolicyPlayer {
  return {
    id: "recorded-player",
    availability,
    scheduled: true,
    startingLineup: "unconfirmed",
    startingLineupRule: "not-an-availability-fact",
    nonGamePeriods: [],
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
    maxGamesPlayed: undefined,
    maxInningsPitched: undefined,
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
    startingLineup: "unconfirmed",
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
    maxGamesPlayed: undefined,
    maxInningsPitched: undefined,
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
    startingLineup: "unconfirmed",
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
