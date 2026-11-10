import { assert, it } from "@effect/vitest";
import { Redacted } from "effect";
import * as Effect from "effect/Effect";

import type { YahooSession } from "./credentials.ts";
import {
  crumbPayload,
  datedRosterPayload,
  draftResultsPayload,
  emptyStandingsPayload,
  leagueSettingsPayload,
  leagueSettingsWithPartialWeekWindow,
  leagueSettingsWithZeroLimits,
  matchupsPayload,
  pendingTradeAsTransactionPayload,
  pendingTradesPayload,
  playerFactsPayload,
  rosterPayload,
  rotoStandingsPayload,
  seasonPlayerDetailsPayload,
  sessionPayload,
  standingsPayload,
  tradeTransactionsPayload,
  transactionRefusal,
  transactionsPayload,
  weekPlayerDetailsForAnotherWeek,
  weekPlayerDetailsPayload,
} from "./fixturesTest.ts";
import * as Yahoo from "./index.ts";
import { jsonResponse, recordingClient, testLayer, textResponse } from "./testSupportTest.ts";

const session: YahooSession = { cookie: Redacted.make("T=test-session; Y=test-user") };

type WithSession<T> = T & { readonly session?: YahooSession };

const client = {
  validateSession: (input: { readonly session?: YahooSession }) => Yahoo.session.validate(input),
  readLeagueSettings: (input: WithSession<Yahoo.leagues.SettingsRequest>) =>
    Yahoo.leagues.settings(input),
  readLeagueTeams: (input: WithSession<Yahoo.teams.ListRequest>) => Yahoo.teams.list(input),
  readStandings: (input: WithSession<Yahoo.leagues.StandingsRequest>) =>
    Yahoo.leagues.standings(input),
  readRoster: (input: WithSession<Yahoo.rosters.ForTeamRequest>) => Yahoo.rosters.forTeam(input),
  readPlayerDetails: (input: WithSession<Yahoo.players.DetailsRequest>) =>
    Yahoo.players.details(input),
  readMatchups: (input: WithSession<Yahoo.matchups.WeekRequest>) => Yahoo.matchups.week(input),
  readDraftResults: (input: WithSession<Yahoo.draft.ResultsRequest>) => Yahoo.draft.results(input),
  readTransactions: (input: WithSession<Yahoo.transactions.ListRequest>) =>
    Yahoo.transactions.list(input),
  readPendingTrades: (input: WithSession<Yahoo.transactions.PendingTradesRequest>) =>
    Yahoo.transactions.pendingTrades(input),
  applyNativeAction: (input: WithSession<Yahoo.lineups.SetNativeRequest>) =>
    Yahoo.lineups.setNative(input),
  applyExplicitAssignments: (input: WithSession<Yahoo.lineups.AssignRequest>) =>
    Yahoo.lineups.assign(input),
  applyTransaction: (input: WithSession<Yahoo.transactions.ApplyRequest>) =>
    Yahoo.transactions.apply(input),
  applyReserveMove: (input: WithSession<Yahoo.lineups.ReserveRequest>) =>
    Yahoo.lineups.reserve(input),
  proposeTrade: (input: WithSession<Yahoo.trades.ProposeRequest>) => Yahoo.trades.propose(input),
  counterTrade: (input: WithSession<Yahoo.trades.CounterRequest>) => Yahoo.trades.counter(input),
  respondTrade: (input: WithSession<Yahoo.trades.RespondRequest>) => Yahoo.trades.respond(input),
  withdrawTrade: (input: WithSession<Yahoo.trades.WithdrawRequest>) => Yahoo.trades.withdraw(input),
};

it.effect("validates a session with one exact read request", () => {
  const recording = recordingClient(() => jsonResponse(sessionPayload));
  return Effect.gen(function* () {
    yield* client.validateSession({ session });

    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/users;use_login=1?format=json",
    );
    assert.strictEqual(call.method, "GET");
    assert.strictEqual(call.headers["cookie"], "T=test-session; Y=test-user");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("rejects a session the provider answers with no user", () => {
  const recording = recordingClient(() => jsonResponse({ fantasy_content: { users: [] } }));
  return Effect.gen(function* () {
    const error = yield* Effect.flip(client.validateSession({ session }));

    assert.strictEqual(error._tag, "Unauthorized");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads league settings into named slots, categories, and modifiers", () => {
  const recording = recordingClient(() => jsonResponse(leagueSettingsPayload));
  return Effect.gen(function* () {
    const league = yield* client.readLeagueSettings({ session, leagueKey: "466.l.4000" });

    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/settings?format=json",
    );
    assert.strictEqual(league.name, "Synthetic NFL League");
    assert.strictEqual(league.season, 2026);
    assert.strictEqual(league.teamCount, 12);
    assert.deepStrictEqual([league.currentWeek, league.startWeek, league.endWeek], [6, 1, 17]);
    assert.strictEqual(league.weeklyDeadline, "game");
    assert.strictEqual(league.editKey, "42");
    assert.deepStrictEqual(league.settings.rosterPositions, [
      { position: "QB", positionType: "O", count: 1, isStartingPosition: true },
      { position: "WR", positionType: "O", count: 2, isStartingPosition: true },
      { position: "BN", positionType: "B", count: 6, isStartingPosition: false },
      { position: "IR", positionType: "I", count: 1, isStartingPosition: false },
    ]);
    assert.strictEqual(league.settings.statCategories.length, 2);
    assert.strictEqual(league.settings.statCategories[1]?.displayOnly, true);
    assert.deepStrictEqual(league.settings.statModifiers, [
      { statId: 4, value: 0.04 },
      { statId: 9, value: 6 },
    ]);
    assert.strictEqual(league.settings.usesFaab, false);
    assert.strictEqual(league.settings.tradeRatifyType, "commish");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("keeps declared zero acquisition limits and leaves zero caps absent", () => {
  const recording = recordingClient(() => jsonResponse(leagueSettingsWithZeroLimits));
  return Effect.gen(function* () {
    const league = yield* client.readLeagueSettings({ session, leagueKey: "466.l.4000" });

    assert.strictEqual(league.settings.maxWeeklyAdds, 0);
    assert.strictEqual(league.settings.maxAdds, 0);
    assert.isUndefined(league.settings.maxGamesPlayed);
    assert.isUndefined(league.settings.maxInningsPitched);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reports a partially published week window by field", () => {
  const recording = recordingClient(() => jsonResponse(leagueSettingsWithPartialWeekWindow));
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      client.readLeagueSettings({ session, leagueKey: "466.l.4000" }),
    );

    assert.strictEqual(error._tag, "YahooParseError");
    assert.strictEqual(
      error._tag === "YahooParseError" ? error.field : undefined,
      "league.end_week",
    );
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads head-to-head standings with record, points, usage, and streak", () => {
  const recording = recordingClient(() => jsonResponse(standingsPayload));
  return Effect.gen(function* () {
    const standings = yield* client.readStandings({ session, leagueKey: "466.l.4000" });

    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/standings?format=json",
    );
    assert.strictEqual(standings.leagueKey, "466.l.4000");
    assert.deepStrictEqual(
      standings.teams.map((team) => team.teamKey),
      ["466.l.4000.t.1", "466.l.4000.t.2"],
    );
    assert.deepStrictEqual(standings.teams[0], {
      teamKey: "466.l.4000.t.1",
      name: "Synthetic NFL Team",
      rank: 1,
      playoffSeed: 1,
      record: { wins: 8, losses: 1, ties: 0, percentage: 0.889 },
      gamesBack: null,
      pointsBack: null,
      points: 1058.16,
      pointsFor: 1058.16,
      pointsAgainst: 986.1,
      streak: { type: "win", value: 1 },
      acquisitionUsage: {
        seasonMoves: 4,
        weeklyAdds: { used: 0, coverage: { type: "week", week: 10 } },
      },
      categoryTotals: [],
      categoryPoints: [],
    });
    assert.strictEqual(standings.teams[1]?.points, 1132.12);
    assert.deepStrictEqual(standings.teams[1]?.record, {
      wins: 6,
      losses: 3,
      ties: 0,
      percentage: 0.667,
    });
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads rotisserie standings with category totals and published points", () => {
  const recording = recordingClient(() => jsonResponse(rotoStandingsPayload));
  return Effect.gen(function* () {
    const standings = yield* client.readStandings({ session, leagueKey: "466.l.4002" });

    const first = standings.teams[0];
    if (first === undefined) {
      return yield* Effect.die("expected a standing");
    }
    assert.isUndefined(first.record);
    assert.strictEqual(first.rank, 1);
    assert.strictEqual(first.points, 110);
    assert.strictEqual(first.pointsFor, 110);
    assert.strictEqual(first.pointsBack, 0);
    assert.isNull(first.gamesBack);
    assert.isNull(first.pointsAgainst);
    assert.deepStrictEqual(first.acquisitionUsage, {
      seasonMoves: 9,
      weeklyAdds: { used: 0, coverage: { type: "week", week: 7 } },
    });
    assert.strictEqual(first.categoryTotals.length, 15);
    assert.deepStrictEqual(first.categoryTotals.slice(0, 3), [
      { statId: 29, value: 279 },
      { statId: 1, value: 81 },
      { statId: 2, value: 178 },
    ]);
    assert.deepStrictEqual(first.categoryTotals.at(-1), { statId: 26, value: 0.903 });
    assert.strictEqual(first.categoryPoints.length, 15);
    assert.deepStrictEqual(first.categoryPoints.slice(0, 2), [
      { statId: 29, value: null },
      { statId: 1, value: 9 },
    ]);
    assert.deepStrictEqual(first.categoryPoints.at(-1), { statId: 26, value: 10 });
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("rejects standings for another league", () => {
  const recording = recordingClient(() => jsonResponse(standingsPayload));
  return Effect.gen(function* () {
    const error = yield* Effect.flip(client.readStandings({ session, leagueKey: "466.l.4999" }));

    assert.strictEqual(error._tag, "YahooParseError");
    assert.strictEqual(
      error._tag === "YahooParseError" ? error.field : undefined,
      "league.league_key",
    );
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("rejects standings with no teams", () => {
  const recording = recordingClient(() => jsonResponse(emptyStandingsPayload));
  return Effect.gen(function* () {
    const error = yield* Effect.flip(client.readStandings({ session, leagueKey: "466.l.4000" }));

    assert.strictEqual(error._tag, "YahooParseError");
    assert.isUndefined(error._tag === "YahooParseError" ? error.field : undefined);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads a week roster with coverage, starting status, and injury facts", () => {
  const recording = recordingClient(() => jsonResponse(rosterPayload));
  return Effect.gen(function* () {
    const roster = yield* client.readRoster({
      session,
      teamKey: "466.l.4000.t.1",
      coverage: { type: "week", week: 6 },
    });

    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/team/466.l.4000.t.1/roster;week=6/players;out=opponent,starting_status,transactions?format=json",
    );
    assert.deepStrictEqual(roster.coverage, { type: "week", week: 6 });
    assert.strictEqual(roster.editable, true);
    assert.strictEqual(roster.players.length, 3);

    const starter = roster.players[0];
    const reserve = roster.players[1];
    const emptySlot = roster.players[2];
    if (starter === undefined || reserve === undefined || emptySlot === undefined) {
      return yield* Effect.die("expected three roster players");
    }
    assert.strictEqual(starter.playerKey, "466.p.20001");
    assert.strictEqual(starter.selectedPosition.position, "QB");
    assert.strictEqual(starter.proTeamAbbreviation, "SYN");
    assert.strictEqual(starter.proTeamKey, "nfl.t.2");
    assert.deepStrictEqual(starter.startingStatus, {
      coverage: { type: "week", week: 6 },
      starting: true,
    });
    assert.strictEqual(starter.opponent, "SEA");
    assert.strictEqual(starter.byeWeek, 7);
    assert.deepStrictEqual(starter.transactions, {
      total: 120,
      adds: 37,
      drops: 3,
      trades: 80,
    });
    assert.strictEqual(starter.editable, true);
    assert.strictEqual(reserve.statusCode, "O");
    assert.strictEqual(reserve.statusDetail, "Synthetic injury note");
    assert.strictEqual(reserve.undroppable, true);
    assert.strictEqual(reserve.editable, false);
    assert.strictEqual(reserve.opponent, null);
    assert.strictEqual(emptySlot.selectedPosition.position, "");
    assert.strictEqual(emptySlot.opponent, "Bye");
    assert.strictEqual(emptySlot.startingStatus, undefined);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reports a roster whose coverage differs from the requested week", () => {
  const recording = recordingClient(() => jsonResponse(rosterPayload));
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      client.readRoster({
        session,
        teamKey: "466.l.4000.t.1",
        coverage: { type: "week", week: 7 },
      }),
    );

    assert.strictEqual(error._tag, "YahooCoverageMismatch");
    if (error._tag === "YahooCoverageMismatch") {
      assert.deepStrictEqual(error.requested, { type: "week", week: 7 });
      assert.deepStrictEqual(error.covered, { type: "week", week: 6 });
    }
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads a date roster and keeps the provider's date coverage", () => {
  const recording = recordingClient(() => jsonResponse(datedRosterPayload));
  return Effect.gen(function* () {
    const roster = yield* client.readRoster({
      session,
      teamKey: "466.l.4002.t.3",
      coverage: { type: "date", date: "2026-10-17" },
    });

    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/team/466.l.4002.t.3/roster;date=2026-10-17/players;out=opponent,starting_status,transactions?format=json",
    );
    assert.deepStrictEqual(roster.coverage, { type: "date", date: "2026-10-17" });
    assert.deepStrictEqual(roster.players[0]?.selectedPosition.coverage, {
      type: "date",
      date: "2026-10-17",
    });
    assert.strictEqual(roster.players[0]?.proTeamAbbreviation, "SYN");
    assert.strictEqual(roster.players[0]?.proTeamKey, "nhl.t.17");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads season player details with ownership and missing stats preserved as null", () => {
  const recording = recordingClient(() => jsonResponse(seasonPlayerDetailsPayload));
  return Effect.gen(function* () {
    const details = yield* client.readPlayerDetails({
      session,
      leagueKey: "466.l.4000",
      playerKeys: ["466.p.20001"],
      stats: { type: "season" },
    });

    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/players;player_keys=466.p.20001;out=stats,ownership?format=json&stats.type=season",
    );
    assert.deepStrictEqual(details, [
      {
        playerKey: "466.p.20001",
        name: "Synthetic Starter",
        primaryPosition: "QB",
        displayPosition: "QB",
        positionType: "O",
        proTeamAbbreviation: "SYN",
        eligiblePositions: ["QB", "W/R"],
        ownershipType: "freeagents",
        percentOwned: undefined,
        percentStarted: undefined,
        ranks: [],
        stats: {
          coverage: { type: "season" },
          values: [
            { statId: 4, value: 1640 },
            { statId: 9, value: 11 },
          ],
        },
        status: undefined,
      },
    ]);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads week player details with percent owned and started values", () => {
  const recording = recordingClient(() => jsonResponse(weekPlayerDetailsPayload));
  return Effect.gen(function* () {
    const details = yield* client.readPlayerDetails({
      session,
      leagueKey: "466.l.4000",
      playerKeys: ["466.p.20001"],
      stats: { type: "week", week: 6 },
    });

    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/players;player_keys=466.p.20001;out=stats,ownership?format=json&stats.type=week&stats.week=6",
    );
    assert.deepStrictEqual(details[0]?.stats, {
      coverage: { type: "week", week: 6 },
      values: [
        { statId: 4, value: 287 },
        { statId: 9, value: 2 },
        { statId: 79, value: null },
      ],
    });
    assert.deepStrictEqual(details[0]?.percentOwned, {
      coverage: { type: "week", week: 6 },
      value: 88,
      delta: null,
    });
    assert.deepStrictEqual(details[0]?.percentStarted, {
      coverage: { type: "week", week: 6 },
      value: 38,
      delta: 10,
    });
    assert.deepStrictEqual(details[0]?.ranks, [{ type: "OR", value: 11, season: undefined }]);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads requested player fields, rank types, and cut types", () => {
  const recording = recordingClient(() => jsonResponse(playerFactsPayload));
  return Effect.gen(function* () {
    const details = yield* client.readPlayerDetails({
      session,
      leagueKey: "466.l.4000",
      playerKeys: ["466.p.20001"],
      fields: ["percent_started", "percent_owned", "ranks", "opponent"],
      ranks: ["projected_week", "last4weeks"],
      percentStartedCutTypes: ["diamond"],
    });

    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/players;player_keys=466.p.20001;out=percent_started,percent_owned,ranks,opponent;ranks=projected_week,last4weeks?format=json&percent_started.cut_types=diamond",
    );
    assert.deepStrictEqual(details[0]?.percentStarted, {
      coverage: { type: "week", week: 6 },
      value: 38,
      delta: null,
      cuts: [{ cut: "diamond", value: 12 }],
    });
    assert.deepStrictEqual(details[0]?.percentOwned, {
      coverage: { type: "week", week: 6 },
      value: 88,
      delta: 2,
    });
    assert.deepStrictEqual(details[0]?.ranks, [
      { type: "PW", value: 3, season: undefined, week: 6 },
      { type: "L4W", value: 11, season: undefined },
    ]);
    assert.strictEqual(details[0]?.opponent, "@SEA");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reports a player-stat week that differs from the requested week", () => {
  const recording = recordingClient(() => jsonResponse(weekPlayerDetailsForAnotherWeek));
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      client.readPlayerDetails({
        session,
        leagueKey: "466.l.4000",
        playerKeys: ["466.p.20001"],
        stats: { type: "week", week: 6 },
      }),
    );

    assert.strictEqual(error._tag, "YahooCoverageMismatch");
    if (error._tag === "YahooCoverageMismatch") {
      assert.deepStrictEqual(error.requested, { type: "week", week: 6 });
      assert.deepStrictEqual(error.covered, { type: "week", week: 5 });
    }
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("refuses more player keys than one detail read accepts", () => {
  const recording = recordingClient(() => jsonResponse(weekPlayerDetailsPayload));
  const playerKeys = Array.from({ length: 26 }, (_, index) => `466.p.${String(index + 20_000)}`);
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      client.readPlayerDetails({
        session,
        leagueKey: "466.l.4000",
        playerKeys,
        stats: { type: "week", week: 6 },
      }),
    );

    assert.strictEqual(error._tag, "YahooRequestInvalid");
    assert.strictEqual(recording.calls.length, 0);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads matchups with both team scores and category winners", () => {
  const recording = recordingClient(() => jsonResponse(matchupsPayload));
  return Effect.gen(function* () {
    const matchups = yield* client.readMatchups({
      session,
      leagueKey: "466.l.4000",
      week: 6,
    });

    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/scoreboard;week=6?format=json",
    );
    assert.deepStrictEqual(matchups, [
      {
        week: 6,
        weekStart: "2026-10-15",
        weekEnd: "2026-10-19",
        status: "postevent",
        isPlayoffs: false,
        isConsolation: false,
        isTied: false,
        home: {
          teamKey: "466.l.4000.t.1",
          name: "Synthetic NFL Team",
          points: 101.25,
          projectedPoints: 109.4,
          winProbability: 0.62,
          remainingGames: { week: 6, completed: 3, live: 1, remaining: 5 },
          stats: [{ statId: 4, value: 287 }],
        },
        away: {
          teamKey: "466.l.4000.t.2",
          name: "Synthetic Rival",
          points: 98.5,
          projectedPoints: 104.1,
          winProbability: 0.38,
          remainingGames: { week: 6, completed: 3, live: 1, remaining: 5 },
          stats: [{ statId: 4, value: 287 }],
        },
        categoryWinners: [{ statId: 4, winnerTeamKey: "466.l.4000.t.1", isTied: false }],
      },
    ]);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reports a scoreboard week that differs from the requested week", () => {
  const recording = recordingClient(() => jsonResponse(matchupsPayload));
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      client.readMatchups({ session, leagueKey: "466.l.4000", week: 7 }),
    );

    assert.strictEqual(error._tag, "YahooCoverageMismatch");
    if (error._tag === "YahooCoverageMismatch") {
      assert.deepStrictEqual(error.covered, { type: "week", week: 6 });
    }
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads draft results with the optional player name", () => {
  const recording = recordingClient(() => jsonResponse(draftResultsPayload));
  return Effect.gen(function* () {
    const picks = yield* client.readDraftResults({ session, leagueKey: "466.l.4000" });

    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/draftresults;out=players?format=json",
    );
    assert.deepStrictEqual(picks, [
      {
        round: 1,
        pick: 1,
        teamKey: "466.l.4000.t.1",
        playerKey: "466.p.20003",
        name: "Synthetic Pick One",
      },
      { round: 1, pick: 2, teamKey: "466.l.4000.t.2", playerKey: "466.p.20006" },
    ]);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads transactions with instant timestamps and both movement sides", () => {
  const recording = recordingClient(() => jsonResponse(transactionsPayload));
  return Effect.gen(function* () {
    const transactions = yield* client.readTransactions({
      session,
      leagueKey: "466.l.4000",
      teamKey: undefined,
      limit: 50,
      offset: undefined,
    });

    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/transactions;count=50?format=json",
    );
    const transaction = transactions[0];
    if (transaction === undefined) {
      return yield* Effect.die("expected one transaction");
    }
    assert.strictEqual(transaction.transactionKey, "466.l.4000.tr.1");
    assert.strictEqual(transaction.type, "add_drop");
    assert.strictEqual(transaction.occurredAt, "2026-10-03T04:00:00.000Z");
    assert.strictEqual(transaction.players.length, 2);
    assert.deepStrictEqual(transaction.players[0]?.movement, {
      kind: "add",
      from: undefined,
      to: { teamKey: "466.l.4000.t.1", name: "Synthetic Team" },
    });
    assert.deepStrictEqual(transaction.players[1]?.movement, {
      kind: "drop",
      from: { teamKey: "466.l.4000.t.1", name: "Synthetic Team" },
      to: undefined,
    });
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("publishes pending_trade as its own transaction type", () => {
  const recording = recordingClient(() => jsonResponse(pendingTradeAsTransactionPayload));
  return Effect.gen(function* () {
    const transactions = yield* client.readTransactions({
      session,
      leagueKey: "466.l.4000",
      teamKey: undefined,
      limit: 50,
      offset: undefined,
    });

    assert.strictEqual(transactions[0]?.type, "pending_trade");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("filters transactions by an owned team and paginates with start", () => {
  const recording = recordingClient(() => jsonResponse(transactionsPayload));
  return Effect.gen(function* () {
    yield* client.readTransactions({
      session,
      leagueKey: "466.l.4000",
      teamKey: "466.l.4000.t.1",
      limit: 10,
      offset: 20,
    });

    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/transactions;count=10;start=20;team_key=466.l.4000.t.1?format=json",
    );
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("filters transactions to trades and keeps the provider's order", () => {
  const recording = recordingClient(() => jsonResponse(tradeTransactionsPayload));
  return Effect.gen(function* () {
    const transactions = yield* client.readTransactions({
      session,
      leagueKey: "466.l.4000",
      teamKey: "466.l.4000.t.1",
      limit: 10,
      offset: 20,
      type: "trade",
    });

    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/transactions;type=trade;team_key=466.l.4000.t.1;count=10;start=20?format=json",
    );
    assert.deepStrictEqual(
      transactions.map((transaction) => transaction.transactionKey),
      ["466.l.4000.tr.7", "466.l.4000.tr.6"],
    );
    assert.isTrue(transactions.every((transaction) => transaction.type === "trade"));
    assert.strictEqual(transactions[0]?.picks.length, 2);
    assert.strictEqual(transactions[0]?.players.length, 2);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("filters transactions by another type with its provider token", () => {
  const recording = recordingClient(() => jsonResponse(transactionsPayload));
  return Effect.gen(function* () {
    const transactions = yield* client.readTransactions({
      session,
      leagueKey: "466.l.4000",
      limit: 50,
      type: "add_drop",
    });

    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/transactions;type=add/drop;count=50?format=json",
    );
    assert.deepStrictEqual(
      transactions.map((transaction) => transaction.type),
      ["add_drop"],
    );
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("drops a non-trade row the provider returns for a trade filter", () => {
  const recording = recordingClient(() => jsonResponse(transactionsPayload));
  return Effect.gen(function* () {
    const transactions = yield* client.readTransactions({
      session,
      leagueKey: "466.l.4000",
      limit: 50,
      type: "trade",
    });

    assert.deepStrictEqual(transactions, []);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads pending trade offers with parties, note, and pick movement", () => {
  const recording = recordingClient(() => jsonResponse(pendingTradesPayload));
  return Effect.gen(function* () {
    const offers = yield* client.readPendingTrades({
      session,
      leagueKey: "466.l.4000",
      teamKey: "466.l.4000.t.1",
    });

    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/transactions;type=pending_trade;team_key=466.l.4000.t.1?format=json",
    );
    const offer = offers[0];
    if (offer === undefined) {
      return yield* Effect.die("expected one offer");
    }
    assert.strictEqual(offer.transactionKey, "466.l.4000.pt.7");
    assert.strictEqual(offer.proposedAt, "2026-10-03T04:00:00.000Z");
    assert.strictEqual(offer.note, "A synthetic offer.");
    assert.strictEqual(offer.canRespond, 1);
    assert.strictEqual(offer.unusedRosterSpots, 0);
    assert.deepStrictEqual(offer.proposer, {
      teamKey: "466.l.4000.t.2",
      name: "Synthetic Rival",
    });
    assert.deepStrictEqual(offer.receiver, {
      teamKey: "466.l.4000.t.1",
      name: "Synthetic Team",
    });
    assert.deepStrictEqual(offer.picks, [
      {
        round: 3,
        from: { teamKey: "466.l.4000.t.2", name: "Synthetic Rival" },
        to: { teamKey: "466.l.4000.t.1", name: "Synthetic Team" },
        original: { teamKey: "466.l.4000.t.1", name: "Synthetic Team" },
      },
    ]);
    assert.strictEqual(offer.players[0]?.movement.kind, "pending_trade");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("applies a native lineup action with the crumb handshake first", () => {
  const recording = recordingClient((call) =>
    call.url.includes("getCrumb") ? jsonResponse(crumbPayload) : textResponse("{}", 200),
  );
  return Effect.gen(function* () {
    const result = yield* client.applyNativeAction({
      session,
      teamKey: "466.l.4000.t.1",
      coverage: { type: "week", week: 6 },
    });

    assert.deepStrictEqual(result, { status: "accepted" });
    assert.strictEqual(recording.calls.length, 2);
    const crumb = recording.calls[0];
    const write = recording.calls[1];
    if (crumb === undefined || write === undefined) {
      return yield* Effect.die("expected crumb then write");
    }
    assert.strictEqual(
      crumb.url,
      "https://pub-api.fantasysports.yahoo.com/fantasy/v3/getCrumb?format=json_f",
    );
    assert.strictEqual(
      write.url,
      "https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2/team/466.l.4000.t.1/roster?format=json_f&crumb=canary-crumb-value",
    );
    assert.strictEqual(write.method, "PUT");
    assert.strictEqual(write.headers["content-type"], "application/xml");
    assert.strictEqual(
      yield* Effect.promise(() => write.body),
      '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><roster><coverage_type>week</coverage_type><week>6</week><action>start_active_players</action></roster></fantasy_content>',
    );
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("applies explicit assignments for a date and retains every listed player", () => {
  const recording = recordingClient((call) =>
    call.url.includes("getCrumb") ? jsonResponse(crumbPayload) : textResponse("{}", 200),
  );
  return Effect.gen(function* () {
    const result = yield* client.applyExplicitAssignments({
      session,
      teamKey: "466.l.4002.t.3",
      coverage: { type: "date", date: "2026-10-17" },
      assignments: [
        { playerKey: "466.p.30001", slot: "C" },
        { playerKey: "466.p.30002", slot: "BN" },
      ],
    });

    assert.deepStrictEqual(result, { status: "accepted" });
    assert.strictEqual(recording.calls.length, 2);
    const write = recording.calls[1];
    if (write === undefined) {
      return yield* Effect.die("expected a write");
    }
    assert.strictEqual(
      yield* Effect.promise(() => write.body),
      '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><roster><coverage_type>date</coverage_type><date>2026-10-17</date><players><player><player_key>466.p.30001</player_key><position>C</position></player><player><player_key>466.p.30002</player_key><position>BN</position></player></players></roster></fantasy_content>',
    );
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("carries the provider's own refusal sentence on a rejected transaction", () => {
  const recording = recordingClient((call) =>
    call.url.includes("getCrumb")
      ? jsonResponse(crumbPayload)
      : textResponse(transactionRefusal.response.body, transactionRefusal.response.status),
  );
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      client.applyTransaction({
        session,
        leagueKey: "466.l.4000",
        teamKey: "466.l.4000.t.1",
        add: "466.p.20003",
        drop: "466.p.20004",
        faabBid: undefined,
      }),
    );

    assert.strictEqual(error._tag, "BadRequest");
    if (error._tag === "BadRequest") {
      assert.strictEqual(
        error.message,
        "Player Synthetic Player is in a IR position on your roster, but is no longer on the real-life IR.  Please edit your lineup to activate this player from your IR and then attempt your transaction again.",
      );
      assert.notInclude(error.message, "crumb");
    }
    assert.strictEqual(recording.calls.length, 2);
    const write = recording.calls[1];
    if (write === undefined) {
      return yield* Effect.die("expected a write");
    }
    assert.strictEqual(write.method, "POST");
    assert.strictEqual(
      write.url,
      "https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/transactions?format=json_f&crumb=canary-crumb-value",
    );
    assert.strictEqual(yield* Effect.promise(() => write.body), transactionRefusal.request.body);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("does not send a transaction when the crumb is missing", () => {
  const recording = recordingClient(() => jsonResponse({ service: { crumb: null } }));
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      client.applyTransaction({
        session,
        leagueKey: "466.l.4000",
        teamKey: "466.l.4000.t.1",
        add: "466.p.20003",
        drop: undefined,
        faabBid: undefined,
      }),
    );

    assert.strictEqual(error._tag, "YahooNotSent");
    if (error._tag === "YahooNotSent") {
      assert.strictEqual(error.reason, "session_incomplete");
    }
    assert.strictEqual(recording.calls.length, 1);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reports an unknown write outcome after a server failure", () => {
  const recording = recordingClient((call) =>
    call.url.includes("getCrumb")
      ? jsonResponse(crumbPayload)
      : textResponse("Service Unavailable", 503),
  );
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      client.applyNativeAction({
        session,
        teamKey: "466.l.4000.t.1",
        coverage: { type: "week", week: 6 },
      }),
    );

    assert.strictEqual(error._tag, "YahooWriteUnknown");
    if (error._tag === "YahooWriteUnknown") {
      assert.strictEqual(error.status, 503);
      assert.strictEqual(error.message, "Service Unavailable");
    }
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reports a rate-limited write as not sent", () => {
  const recording = recordingClient((call) =>
    call.url.includes("getCrumb")
      ? jsonResponse(crumbPayload)
      : textResponse("Too Many Requests", 429),
  );
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      client.applyReserveMove({
        session,
        teamKey: "466.l.4000.t.1",
        coverage: { type: "week", week: 6 },
        playerKey: "466.p.20002",
        slot: "IR",
      }),
    );

    assert.strictEqual(error._tag, "YahooNotSent");
    if (error._tag === "YahooNotSent") {
      assert.strictEqual(error.reason, "request_failed");
      assert.strictEqual(error.status, 429);
    }
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("proposes a two-sided trade and reads the pending key from the response", () => {
  const recording = recordingClient((call) =>
    call.url.includes("getCrumb")
      ? jsonResponse(crumbPayload)
      : jsonResponse(
          {
            fantasy_content: {
              transactions: {
                "0": {
                  transaction: [{ transaction_key: "466.l.4000.pt.9", type: "pending_trade" }],
                },
                count: 1,
              },
            },
          },
          201,
        ),
  );
  return Effect.gen(function* () {
    const result = yield* client.proposeTrade({
      session,
      leagueKey: "466.l.4000",
      traderTeamKey: "466.l.4000.t.1",
      tradeeTeamKey: "466.l.4000.t.2",
      send: ["466.p.20001"],
      receive: ["466.p.20003"],
      note: undefined,
    });

    assert.deepStrictEqual(result, {
      status: "accepted",
      transactionKey: "466.l.4000.pt.9",
    });
    const write = recording.calls[1];
    if (write === undefined) {
      return yield* Effect.die("expected a write");
    }
    assert.strictEqual(write.method, "POST");
    assert.strictEqual(
      yield* Effect.promise(() => write.body),
      '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><transaction><type>pending_trade</type><trader_team_key>466.l.4000.t.1</trader_team_key><tradee_team_key>466.l.4000.t.2</tradee_team_key><trade_note></trade_note><players><player><player_key>466.p.20001</player_key><transaction_data><type>pending_trade</type><source_team_key>466.l.4000.t.1</source_team_key><destination_team_key>466.l.4000.t.2</destination_team_key></transaction_data></player><player><player_key>466.p.20003</player_key><transaction_data><type>pending_trade</type><source_team_key>466.l.4000.t.2</source_team_key><destination_team_key>466.l.4000.t.1</destination_team_key></transaction_data></player></players></transaction></fantasy_content>',
    );
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("does not claim acceptance of a trade whose pending key is absent", () => {
  const recording = recordingClient((call) =>
    call.url.includes("getCrumb")
      ? jsonResponse(crumbPayload)
      : jsonResponse({ fantasy_content: { league: [] } }, 201),
  );
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      client.proposeTrade({
        session,
        leagueKey: "466.l.4000",
        traderTeamKey: "466.l.4000.t.1",
        tradeeTeamKey: "466.l.4000.t.2",
        send: ["466.p.20001"],
        receive: ["466.p.20003"],
        note: undefined,
      }),
    );

    assert.strictEqual(error._tag, "YahooWriteUnknown");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("counters an incoming offer back to its proposer with one new proposal", () => {
  const recording = recordingClient((call) =>
    call.url.includes("getCrumb")
      ? jsonResponse(crumbPayload)
      : jsonResponse(
          {
            fantasy_content: {
              transaction: {
                transaction_key: "466.l.4000.pt.10",
                type: "pending_trade",
              },
            },
          },
          201,
        ),
  );
  return Effect.gen(function* () {
    const result = yield* client.counterTrade({
      session,
      offer: {
        transactionKey: "466.l.4000.pt.9",
        proposerTeamKey: "466.l.4000.t.2",
        receiverTeamKey: "466.l.4000.t.1",
      },
      send: ["466.p.20001"],
      receive: ["466.p.20003"],
      note: "Counter",
    });

    assert.deepStrictEqual(result, {
      status: "accepted",
      transactionKey: "466.l.4000.pt.10",
    });
    const write = recording.calls[1];
    if (write === undefined) {
      return yield* Effect.die("expected a write");
    }
    assert.strictEqual(write.method, "POST");
    assert.strictEqual(
      write.url,
      "https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/transactions?format=json_f&crumb=canary-crumb-value",
    );
    assert.strictEqual(
      yield* Effect.promise(() => write.body),
      '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><transaction><type>pending_trade</type><trader_team_key>466.l.4000.t.1</trader_team_key><tradee_team_key>466.l.4000.t.2</tradee_team_key><trade_note>Counter</trade_note><players><player><player_key>466.p.20001</player_key><transaction_data><type>pending_trade</type><source_team_key>466.l.4000.t.1</source_team_key><destination_team_key>466.l.4000.t.2</destination_team_key></transaction_data></player><player><player_key>466.p.20003</player_key><transaction_data><type>pending_trade</type><source_team_key>466.l.4000.t.2</source_team_key><destination_team_key>466.l.4000.t.1</destination_team_key></transaction_data></player></players></transaction></fantasy_content>',
    );
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("rejects an incoming pending trade with a PUT action", () => {
  const recording = recordingClient((call) =>
    call.url.includes("getCrumb") ? jsonResponse(crumbPayload) : textResponse("", 200),
  );
  return Effect.gen(function* () {
    const result = yield* client.respondTrade({
      session,
      transactionKey: "466.l.4000.pt.9",
      action: "reject",
      note: "No thanks",
    });

    assert.deepStrictEqual(result, { status: "accepted" });
    const write = recording.calls[1];
    if (write === undefined) {
      return yield* Effect.die("expected a write");
    }
    assert.strictEqual(write.method, "PUT");
    assert.strictEqual(
      write.url,
      "https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2/transaction/466.l.4000.pt.9?format=json_f&crumb=canary-crumb-value",
    );
    assert.strictEqual(
      yield* Effect.promise(() => write.body),
      '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><transaction><transaction_key>466.l.4000.pt.9</transaction_key><type>pending_trade</type><action>reject</action><trade_note>No thanks</trade_note></transaction></fantasy_content>',
    );
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("withdraws a trade by its pending key", () => {
  const recording = recordingClient((call) =>
    call.url.includes("getCrumb") ? jsonResponse(crumbPayload) : textResponse("", 200),
  );
  return Effect.gen(function* () {
    const result = yield* client.withdrawTrade({
      session,
      transactionKey: "466.l.4000.pt.9",
    });

    assert.deepStrictEqual(result, { status: "accepted" });
    const write = recording.calls[1];
    if (write === undefined) {
      return yield* Effect.die("expected a write");
    }
    assert.strictEqual(write.method, "DELETE");
    assert.strictEqual(
      write.url,
      "https://pub-api-rw.fantasysports.yahoo.com/fantasy/v2/transaction/466.l.4000.pt.9?format=json_f&crumb=canary-crumb-value",
    );
    assert.strictEqual(yield* Effect.promise(() => write.body), "");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("refuses a team that belongs to another league before sending it", () => {
  const recording = recordingClient(() => jsonResponse(crumbPayload));
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      client.applyTransaction({
        session,
        leagueKey: "466.l.4000",
        teamKey: "477.l.5744.t.6",
        add: "466.p.20003",
        drop: undefined,
        faabBid: undefined,
      }),
    );

    assert.strictEqual(error._tag, "YahooRequestInvalid");
    assert.strictEqual(recording.calls.length, 0);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reports a read refusal with the provider's wording", () => {
  const recording = recordingClient(() =>
    textResponse(
      JSON.stringify({ error: { description: "League 466.l.4000 does not exist." } }),
      404,
    ),
  );
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      client.readLeagueSettings({ session, leagueKey: "466.l.4000" }),
    );

    assert.strictEqual(error._tag, "NotFound");
    if (error._tag === "NotFound") {
      assert.strictEqual(error.message, "League 466.l.4000 does not exist.");
    }
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reports a provider server failure as a failed read with its status", () => {
  const recording = recordingClient(() => textResponse("upstream failure", 503));
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      client.readLeagueSettings({ session, leagueKey: "466.l.4000" }),
    );

    assert.strictEqual(error._tag, "ServiceUnavailable");
    if (error._tag === "ServiceUnavailable") {
      assert.strictEqual(error.message, "upstream failure");
    }
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("rejects an expired session on a read", () => {
  const recording = recordingClient(() => textResponse("unauthorized", 401));
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      client.readLeagueSettings({ session, leagueKey: "466.l.4000" }),
    );

    assert.strictEqual(error._tag, "Unauthorized");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("redacts a crumb echoed in a provider refusal body", () => {
  const recording = recordingClient((call) =>
    call.url.includes("getCrumb")
      ? jsonResponse(crumbPayload)
      : textResponse("refused: crumb=secret-crumb&league=466", 400),
  );
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      client.applyTransaction({
        session,
        leagueKey: "466.l.4000",
        teamKey: "466.l.4000.t.1",
        add: "466.p.20003",
        drop: undefined,
        faabBid: undefined,
      }),
    );

    assert.strictEqual(error._tag, "BadRequest");
    if (error._tag === "BadRequest") {
      assert.strictEqual(error.message, "refused: crumb=<redacted>&league=466");
      assert.notInclude(error.message, "secret-crumb");
    }
  }).pipe(Effect.provide(testLayer(recording.client)));
});
