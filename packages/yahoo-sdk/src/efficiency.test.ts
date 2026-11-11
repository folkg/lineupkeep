import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as Yahoo from "./index.ts";
import { jsonResponse, recordingClient, testLayer } from "./testSupportTest.ts";

const leagueKey = "466.l.4000";
const otherLeagueKey = "477.l.31027";

const team = {
  team_key: "466.l.4000.t.1",
  name: "Synthetic Team",
  is_owned_by_current_login: 1,
};

const player = {
  player_key: "466.p.20001",
  name: { full: "Synthetic Player" },
  primary_position: "QB",
  display_position: "QB",
  selected_position: { coverage_type: "week", week: "6", position: "QB" },
  opponent: "OPP",
  starting_status: [{ coverage_type: "week", week: "6", is_starting: "1" }],
};

it.effect("discovers every league and team in one aggregate read", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      fantasy_content: {
        users: [
          {
            games: [
              {
                code: "nfl",
                season: "2026",
                leagues: [
                  {
                    league: {
                      league_key: leagueKey,
                      name: "Synthetic League",
                      url: "https://football.fantasysports.yahoo.com/f1/4000",
                      num_teams: "12",
                      scoring_type: "head",
                      scoring_label: "H2H",
                      settings: {
                        can_trade_draft_picks: "1",
                        roster_positions: [],
                        stat_categories: { stats: [] },
                      },
                      teams: [team],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );

  return Effect.gen(function* () {
    const leagues = yield* Yahoo.leagues.discover({});
    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/users;use_login=1/games;game_keys=nfl,nhl,nba,mlb/leagues;out=settings/teams;out=standings?format=json",
    );
    assert.strictEqual(leagues[0]?.leagueKey, leagueKey);
    assert.strictEqual(leagues[0]?.name, "Synthetic League");
    assert.strictEqual(leagues[0]?.teams[0]?.teamKey, team.team_key);
    assert.strictEqual(leagues[0]?.tradeDraftPicks, true);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads several league rosters in one aggregate read", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      fantasy_content: {
        users: [
          {
            games: [
              {
                leagues: [
                  {
                    league: {
                      league_key: leagueKey,
                      name: "Synthetic League",
                      teams: [
                        {
                          ...team,
                          roster: {
                            coverage_type: "week",
                            week: "6",
                            players: [player],
                          },
                          transactions: [
                            {
                              transaction_key: "466.l.4000.pt.9",
                              type: "pending_trade",
                              status: "proposed",
                            },
                          ],
                          games_played: [
                            {
                              games_played_by_position_type: {
                                position_type: "O",
                                games_played: [
                                  {
                                    games_played_by_position: {
                                      position: "QB",
                                      games_played: {
                                        played: 6,
                                        max: 17,
                                        projected: 11.5,
                                      },
                                    },
                                  },
                                ],
                              },
                            },
                            {
                              games_played_by_position_type: {
                                position_type: "P",
                                innings_pitched: {
                                  pitched: "82.1",
                                  max: "1400",
                                  projected: "1400.1",
                                },
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );

  return Effect.gen(function* () {
    const rosters = yield* Yahoo.rosters.forLeagues({
      leagueKeys: [leagueKey, otherLeagueKey],
      coverage: { type: "week", week: 6 },
    });
    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.match(call.url, /league_keys=466\.l\.4000,477\.l\.31027/u);
    assert.match(call.url, /roster;week=6/u);
    assert.match(call.url, /transactions\.types=waiver,pending_trade/u);
    assert.strictEqual(rosters[0]?.teamKey, team.team_key);
    assert.deepStrictEqual(rosters[0]?.pendingTransactions, [
      {
        transactionKey: "466.l.4000.pt.9",
        type: "pending_trade",
        status: "proposed",
      },
    ]);
    assert.deepStrictEqual(rosters[0]?.gamesPlayed, [
      {
        positionType: "O",
        positions: [{ position: "QB", played: 6, max: 17, projected: 11.5 }],
      },
      {
        positionType: "P",
        positions: [],
        inningsPitched: { pitched: "82.1", max: "1400", projected: "1400.1" },
      },
    ]);
    assert.strictEqual(rosters[0]?.players[0]?.playerKey, player.player_key);
    assert.strictEqual(rosters[0]?.players[0]?.startingStatus?.starting, true);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads a league entry without the wrapper", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      fantasy_content: {
        users: [
          {
            games: [
              {
                leagues: [
                  {
                    league_key: leagueKey,
                    name: "Synthetic League",
                    teams: [
                      {
                        ...team,
                        roster: {
                          coverage_type: "week",
                          week: "6",
                          players: [player],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );

  return Effect.gen(function* () {
    const rosters = yield* Yahoo.rosters.forLeagues({ leagueKeys: [leagueKey] });
    assert.strictEqual(rosters[0]?.teamKey, team.team_key);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("searches several leagues in one aggregate read", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      fantasy_content: {
        users: [
          {
            games: [
              {
                leagues: [
                  {
                    league: {
                      league_key: leagueKey,
                      players: [
                        {
                          player_key: "466.p.20001",
                          name: { full: "Synthetic Player" },
                          primary_position: "QB",
                          display_position: "QB",
                          eligible_positions: [{ position: "QB" }],
                          ownership: { ownership_type: "freeagents" },
                        },
                      ],
                    },
                  },
                  {
                    league: {
                      league_key: otherLeagueKey,
                      players: [
                        {
                          player_key: "477.p.30001",
                          name: { full: "Synthetic Hockey Player" },
                          primary_position: "C",
                          display_position: "C",
                          eligible_positions: [{ position: "C" }],
                          ownership: { ownership_type: "waivers" },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );

  return Effect.gen(function* () {
    const groups = yield* Yahoo.players.search({
      leagueKeys: [leagueKey, otherLeagueKey],
      availability: "all",
      sort: "name",
      sortType: "season",
      limit: 10,
    });
    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.match(call.url, /league_keys=466\.l\.4000,477\.l\.31027/u);
    assert.strictEqual(groups.length, 2);
    assert.strictEqual(groups[0]?.leagueKey, leagueKey);
    assert.strictEqual(groups[1]?.players[0]?.name, "Synthetic Hockey Player");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("orders a league pool by a recent window and a position at the provider", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      fantasy_content: {
        users: [
          {
            games: [
              {
                leagues: [
                  {
                    league: {
                      league_key: otherLeagueKey,
                      players: [
                        {
                          player_key: "477.p.30001",
                          name: { full: "Synthetic Goalie" },
                          primary_position: "G",
                          display_position: "G",
                          eligible_positions: [{ position: "G" }],
                          ownership: { ownership_type: "freeagents" },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );

  return Effect.gen(function* () {
    const groups = yield* Yahoo.players.search({
      leagueKeys: [otherLeagueKey],
      availability: "free_agent",
      sort: "recent_rank",
      sortType: "season",
      recentWindow: { type: "days", days: 14 },
      position: "G",
      limit: 50,
    });
    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/users;use_login=1/games;game_keys=nfl,nhl,nba,mlb/leagues;league_keys=477.l.31027/players;status=FA;position=G;sort=AR_L14;count=50;out=ownership,percent_owned,percent_started,ranks,transactions,opponent,starting_status?format=json",
    );
    assert.strictEqual(groups[0]?.players[0]?.name, "Synthetic Goalie");
    assert.strictEqual(groups[0]?.players[0]?.primaryPosition, "G");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("maps a four-week window to the provider's four-week sort", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      fantasy_content: {
        users: [
          {
            games: [
              {
                leagues: [
                  {
                    league: {
                      league_key: otherLeagueKey,
                      players: [
                        {
                          player_key: "470.p.30001",
                          name: { full: "Synthetic Receiver" },
                          primary_position: "WR",
                          display_position: "WR",
                          eligible_positions: [{ position: "WR" }],
                          ownership: { ownership_type: "freeagents" },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );

  return Effect.gen(function* () {
    yield* Yahoo.players.search({
      leagueKeys: [otherLeagueKey],
      availability: "free_agent",
      sort: "recent_rank",
      sortType: "season",
      recentWindow: { type: "weeks", weeks: 4 },
      limit: 50,
    });
    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/users;use_login=1/games;game_keys=nfl,nhl,nba,mlb/leagues;league_keys=477.l.31027/players;status=FA;sort=AR_L4W;sort_type=last4weeks;count=50;out=ownership,percent_owned,percent_started,ranks,transactions,opponent,starting_status?format=json",
    );
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("refuses a recent-rank search that names no window", () => {
  const recording = recordingClient(() => jsonResponse({}));

  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      Yahoo.players.search({
        leagueKeys: [otherLeagueKey],
        availability: "free_agent",
        sort: "recent_rank",
        sortType: "season",
        limit: 50,
      }),
    );
    assert.instanceOf(error, Yahoo.YahooRequestInvalid);
    assert.deepStrictEqual(recording.calls, []);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads a game-wide available-player page", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      fantasy_content: {
        games: [
          {
            game_key: "nfl",
            players: [
              {
                player_key: "466.p.20002",
                name: { full: "Synthetic Available" },
                primary_position: "WR",
                display_position: "WR",
                ownership: { ownership_type: "freeagents" },
                opponent: "OPP",
              },
            ],
          },
        ],
      },
    }),
  );

  return Effect.gen(function* () {
    const players = yield* Yahoo.players.available({
      gameKey: "nfl",
      availability: "free_agent",
      position: "WR",
      sort: "actual_rank",
      sortType: "season",
      limit: 25,
      offset: 0,
    });
    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/games;game_keys=nfl/players;status=FA;position=WR;sort=AR;sort_type=season;count=25;start=0;out=ownership,percent_owned,percent_started,ranks,transactions,opponent,starting_status?format=json",
    );
    assert.strictEqual(players[0]?.name, "Synthetic Available");
    assert.strictEqual(players[0]?.opponent, "OPP");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("passes requested ranks and cut types to an available-player page", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      fantasy_content: {
        games: [
          {
            game_key: "nfl",
            players: [
              {
                player_key: "466.p.20002",
                name: { full: "Synthetic Available" },
                primary_position: "WR",
                display_position: "WR",
              },
            ],
          },
        ],
      },
    }),
  );

  return Effect.gen(function* () {
    yield* Yahoo.players.available({
      gameKey: "nfl",
      availability: "all",
      sort: "ownership",
      sortType: "season",
      limit: 25,
      offset: 0,
      ranks: ["projected_week"],
      percentStartedCutTypes: ["diamond"],
    });
    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.include(
      call.url,
      ";out=ownership,percent_owned,percent_started,ranks,transactions,opponent,starting_status;ranks=projected_week",
    );
    assert.include(call.url, "percent_started.cut_types=diamond");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads a date's schedule from Graphite", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      data: {
        leagues: [
          {
            games: [{ gameId: "nfl-1", startTime: "2026-11-08T17:00:00Z", status: "SCHEDULED" }],
          },
        ],
      },
    }),
  );

  return Effect.gen(function* () {
    const games = yield* Yahoo.schedule.byDate({
      sport: "nfl",
      date: "2026-11-08",
      timeZone: "America/Edmonton",
    });
    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://graphite.sports.yahoo.com/v1/query/shangrila/leagueGameIdsByDate?lang=en-US&region=US&tz=America%2FEdmonton&ysp_platform=next-app-sports&leagues=nfl&dates=2026-11-08&season=2026",
    );
    assert.deepStrictEqual(games, [
      { gameId: "nfl-1", startTime: "2026-11-08T17:00:00Z", status: "SCHEDULED" },
    ]);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads a scoreboard game from Graphite", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      data: {
        games: [
          {
            awayTeamId: "1",
            homeTeamId: "2",
            startTime: "2026-11-08T17:00:00Z",
            gameStatus: "POSTPONED",
          },
        ],
      },
    }),
  );

  return Effect.gen(function* () {
    const games = yield* Yahoo.schedule.game({
      gameId: "nfl-1",
      season: 2026,
      timeZone: "America/Edmonton",
    });
    assert.strictEqual(games[0]?.gameStatus, "POSTPONED");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("pages starting players with two league reads", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      fantasy_content: {
        league: [
          { league_key: "477.l.31027" },
          {
            players: [
              {
                player_key: "477.p.40001",
                name: { full: "Synthetic Starter" },
                primary_position: "G",
                display_position: "G",
                eligible_positions: [{ position: "G" }],
              },
            ],
          },
        ],
      },
    }),
  );

  return Effect.gen(function* () {
    const starters = yield* Yahoo.players.starters({
      leagueKey: "477.l.31027",
      position: "S_G",
    });
    assert.strictEqual(recording.calls.length, 2);
    assert.match(recording.calls[0]?.url ?? "", /start=0/u);
    assert.match(recording.calls[1]?.url ?? "", /start=25/u);
    assert.strictEqual(starters.length, 1);
    assert.strictEqual(starters[0]?.playerKey, "477.p.40001");
  }).pipe(Effect.provide(testLayer(recording.client)));
});
