import { assert, it } from "@effect/vitest";
import { TeamSummaryData } from "@lineupkeep/backend/connections/QueryResults";
import { recordHas } from "@lineupkeep/collections";
import { Effect, Schema } from "effect";

import { toTeamOverviewView } from "./teamOverviewPresentation.ts";

const base = {
  status: "ok",
  team: {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1",
    name: "Alpha",
    provider: "yahoo",
    league: "nfl",
    sport: "football",
    season: 2026,
  },
  ownerNote: { status: "not_set" },
  agentNotes: [],
  coverage: [],
  failures: [],
  page: { returned: 0, complete: true, remaining: 0 },
  budget: { targetBytes: 20_000, hardLimitBytes: 28_000 },
};

const league = {
  status: "available",
  name: "League",
  teamCount: 12,
  scoringType: "head",
  scoringLabel: "Custom scoring",
  gamesCaps: {
    gamesPlayed: { status: "published", value: 162 },
    inningsPitched: { status: "published", value: 0 },
  },
  transactionTiming: { weeklyDeadline: "weekly" },
};

it.effect(
  "keeps zeroes, provider scoring labels, and weekly deadlines without exporting references",
  () =>
    Effect.gen(function* () {
      const summary = yield* Schema.decodeUnknownEffect(TeamSummaryData)({
        ...base,
        league,
        standings: { status: "available", format: "head_to_head_categories", teams: [] },
        standing: {
          status: "available",
          rank: 3,
          points: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          pointsBack: 0,
          gamesBack: null,
        },
        record: { status: "available", wins: 7, losses: 3, ties: 0, percentage: null },
        matchup: {
          status: "available",
          period: { week: 11 },
          opponent: { team: "private-opponent-token", name: "Beta" },
          points: 0,
          opponentPoints: 5,
          projectedPoints: 0,
          opponentProjectedPoints: null,
          categories: [
            {
              stat: "private-stat-token",
              name: "Goals",
              own: 0,
              opponent: null,
              scoring: "informational",
            },
          ],
        },
        acquisitionUsage: {
          status: "available",
          limits: { weekly: { status: "not_set" }, season: { status: "not_set" } },
          usage: { status: "not_published", detail: "No moves published." },
          gamesPlayedUsage: {
            status: "available",
            games: [{ position: "C", played: 0, max: 162, projected: 150 }],
          },
        },
      });

      const view = toTeamOverviewView(summary);

      assert.strictEqual(view.league?.scoringLabel, "Custom scoring");
      assert.strictEqual(view.league?.weeklyDeadline, "weekly");
      assert.deepStrictEqual(view.league?.gamesCaps, { gamesPlayed: 162 });
      assert.strictEqual(view.standing?.pointsFor, 0);
      assert.strictEqual(view.record?.percentage, null);
      assert.strictEqual(view.matchup?.categories[0]?.own, 0);
      assert.strictEqual(view.gamesUsage?.status, "available");
      assert.strictEqual(recordHas(view.matchup ?? {}, "team"), false);
      assert.strictEqual(recordHas(view.matchup?.categories[0] ?? {}, "stat"), false);
    }),
);

it.effect("reports rotisserie points without inventing a season record or matchup", () =>
  Effect.gen(function* () {
    const summary = yield* Schema.decodeUnknownEffect(TeamSummaryData)({
      ...base,
      league: { ...league, transactionTiming: { weeklyDeadline: "intraday" } },
      standings: { status: "available", format: "rotisserie", teams: [] },
      record: { status: "unsupported", detail: "This format does not publish a win-loss record." },
      categoryPoints: {
        status: "available",
        values: [{ stat: "stat-token", name: "Goals", value: 0 }],
        omittedCategories: { count: 0, detail: "No categories were omitted." },
      },
      matchup: { status: "unsupported", detail: "The season has no current period." },
    });

    const view = toTeamOverviewView(summary);

    assert.strictEqual(view.format, "rotisserie");
    assert.strictEqual(view.record, undefined);
    assert.strictEqual(view.recordReason, "This format does not publish a win-loss record.");
    assert.strictEqual(view.matchupReason, "The season has no current period.");
    assert.strictEqual(view.categoryPoints?.[0]?.value, 0);
    assert.strictEqual(view.league?.weeklyDeadline, "intraday");
  }),
);

it.effect("preserves unknown scoring type and reasons for absent facts", () =>
  Effect.gen(function* () {
    const summary = yield* Schema.decodeUnknownEffect(TeamSummaryData)({
      ...base,
      league: {
        ...league,
        scoringType: "custom",
        scoringLabel: "Custom points",
        transactionTiming: { weeklyDeadline: "" },
      },
      standings: { status: "available", format: "unknown", teams: [] },
      standing: { status: "unsupported", detail: "Standings unavailable." },
      matchup: { status: "unsupported", detail: "No matchup published." },
    });

    const view = toTeamOverviewView(summary);

    assert.strictEqual(view.format, "unknown");
    assert.strictEqual(view.league?.scoringLabel, "Custom points");
    assert.strictEqual(view.league?.weeklyDeadline, "");
    assert.strictEqual(view.standingReason, "Standings unavailable.");
    assert.strictEqual(view.matchupReason, "No matchup published.");
  }),
);

it.effect("keeps head-to-head points and the current matchup without category guesses", () =>
  Effect.gen(function* () {
    const summary = yield* Schema.decodeUnknownEffect(TeamSummaryData)({
      ...base,
      league: { ...league, scoringLabel: "Head to head, points" },
      standings: { status: "available", format: "head_to_head_points", teams: [] },
      record: { status: "available", wins: 0, losses: 0, ties: 0, percentage: 0 },
      matchup: {
        status: "available",
        period: { week: 3 },
        opponent: { team: "private-token", name: "Beta" },
        points: 0,
        opponentPoints: 25,
        projectedPoints: 50,
        opponentProjectedPoints: 48,
        statusLabel: "Live",
      },
    });

    const view = toTeamOverviewView(summary);

    assert.strictEqual(view.format, "head_to_head_points");
    assert.strictEqual(view.record?.percentage, 0);
    assert.strictEqual(view.matchup?.points, 0);
    assert.strictEqual(view.matchup?.statusLabel, "Live");
    assert.deepStrictEqual(view.matchup?.categories, []);
  }),
);
