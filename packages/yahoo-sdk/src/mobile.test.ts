import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { crumbPayload } from "./fixturesTest.ts";
import * as Yahoo from "./index.ts";
import { jsonResponse, recordingClient, testLayer } from "./testSupportTest.ts";

const leagueKey = "466.l.4000";
const teamKey = "466.l.4000.t.1";
const otherTeamKey = "466.l.4000.t.2";

it.effect("reads a mixed-sport mobile games feed and decodes teams and venue", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      data: {
        sportsGames: {
          sportsLeagues: [
            {
              leagueId: 1,
              sportsNflGames: [
                {
                  gameId: "g1",
                  week: 9,
                  startTime: "2026-11-08T17:00:00Z",
                  startDate: "2026-11-08",
                  displayName: "Away at Home",
                  status: "final",
                  isFinal: true,
                  awayTeam: {
                    teamId: "1",
                    displayName: "Away",
                    abbreviation: "AWY",
                    nickname: "Away",
                    fullName: "Away Team",
                    teamRecord: { wins: 5, losses: 3, ties: 0 },
                  },
                  homeTeam: {
                    teamId: "2",
                    displayName: "Home",
                    abbreviation: "HME",
                    nickname: "Home",
                    fullName: "Home Team",
                    teamRecord: { wins: 6, losses: 2, ties: 0 },
                  },
                  venue: {
                    venueId: "v1",
                    displayName: "Test Field",
                    city: "Testville",
                    state: "TS",
                  },
                  weather: {
                    conditionCode: 1,
                    forecastText: "Clear",
                    temperature: 20,
                    precipitationProbability: 0,
                    windSpeed: 5,
                  },
                },
              ],
            },
          ],
        },
      },
    }),
  );

  return Effect.gen(function* () {
    const games = yield* Yahoo.mobile.games({ league: leagueKey, week: 9 });
    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://api-fantasy-mobile.sports.yahoo.com/v2/fantasy-android/getGames?format=json&league=466.l.4000&week=9",
    );
    assert.strictEqual(games[0]?.awayTeam.abbreviation, "AWY");
    assert.strictEqual(games[0]?.venue?.name, "Test Field");
    assert.strictEqual(games[0]?.weather?.forecast, "Clear");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads mobile player cards with all lazy subviews requested by default", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      data: {
        fantasyPlayerCardsView: {
          playerCards: [
            {
              playerKey: "466.p.1",
              player: {
                displayName: "Synthetic Player",
                shortDisplayName: null,
                position: "QB",
                eligiblePositions: ["QB"],
                teamName: "Synthetic Team",
                teamAbbr: "SYN",
                headshotUrl: null,
                availabilityNote: null,
                ownerTeamKey: null,
              },
              playerStats: [{ label: "Fan Pts", value: "18.4" }],
              availableSubViews: [{ key: "overview", label: "Overview" }],
              leagueData: {
                leagueKey,
                currentScoringWeek: "9",
                placementStatus: "starter",
                ownerTeamName: null,
                ownerTeamKey: null,
                isOnWishlist: false,
                isUndroppable: false,
                fantasyPoints: "18.4",
              },
            },
          ],
        },
      },
    }),
  );

  return Effect.gen(function* () {
    const cards = yield* Yahoo.mobile.playerCards({
      leagueKey,
      playerKeys: ["466.p.1"],
    });
    const call = recording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://api-fantasy-mobile.sports.yahoo.com/v2/fantasy-android/getFantasyPlayerCards?format=json&leagueKey=466.l.4000&playerKeys=466.p.1&subviews=overview%2CgameLog%2CseasonStats%2CleagueAvailability",
    );
    assert.strictEqual(cards[0]?.displayName, "Synthetic Player");
    assert.strictEqual(cards[0]?.leagueData?.placementStatus, "starter");
    assert.deepStrictEqual(cards[0]?.stats, [{ label: "Fan Pts", value: "18.4" }]);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads a mobile player game log with headers and cells", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      data: {
        fantasyPlayerGameLog: {
          content: {
            headers: [
              { value: "Wk", format: null },
              { value: "Fan Pts", format: null },
            ],
            games: [
              {
                id: "1",
                date: "2026-11-01",
                opponentAbbr: "LV",
                cells: [
                  { value: "1", format: null },
                  { value: "17.7", format: null },
                ],
              },
            ],
            statLegend: {
              title: "Legend",
              above: { text: "Above" },
              typical: { text: "Typical" },
              below: { text: "Below" },
            },
          },
        },
      },
    }),
  );

  return Effect.gen(function* () {
    const log = yield* Yahoo.mobile.playerGameLog({
      leagueKey,
      playerKey: "466.p.1",
    });
    assert.deepStrictEqual(log.headers[0], { value: "Wk", format: undefined });
    assert.strictEqual(log.games[0]?.opponentAbbr, "LV");
    assert.strictEqual(log.games[0]?.cells[1]?.value, "17.7");
    assert.strictEqual(log.legend?.above, "Above");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads Felo ratings", () => {
  const feloRecording = recordingClient(() =>
    jsonResponse({
      service: {
        league_key: leagueKey,
        felo_average: "800",
        weekly_change: null,
        current_tier: "gold",
        current_tier_numeric: 3,
        teams: {
          [teamKey]: {
            team_key: teamKey,
            felo_score: "810",
            weekly_change: null,
            current_tier: "gold",
            current_tier_numeric: 3,
            managers: {
              "1": {
                felo_score: "810",
                weekly_change: null,
                current_tier: "gold",
                is_comanager: false,
              },
            },
          },
        },
      },
    }),
  );

  return Effect.gen(function* () {
    const felo = yield* Yahoo.leagues.felo({ leagueKey });
    const call = feloRecording.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected one request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api.fantasysports.yahoo.com/fantasy/v3/game/466/league/4000/felo?format=json",
    );
    assert.strictEqual(felo.average, "800");
    assert.strictEqual(felo.teams[0]?.feloScore, "810");
  }).pipe(Effect.provide(testLayer(feloRecording.client)));
});

it.effect("reads available draft picks and positional ranks for trade analysis", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      fantasy_content: {
        league: {
          league_key: leagueKey,
          teams: [
            {
              team: {
                team_key: teamKey,
                name: "Synthetic Team",
                available_draft_picks: {
                  picks: [
                    { pick: { round: 1, cost: 0, pick: 0 } },
                    { pick: { round: 2, cost: 0, pick: 0 } },
                  ],
                },
                positional_ranks: [{ positional_rank: { position: "QB", rank: 3 } }],
              },
            },
          ],
        },
      },
    }),
  );

  return Effect.gen(function* () {
    const analysis = yield* Yahoo.leagues.teamAnalysis({
      leagueKey,
      teamKeys: [teamKey],
    });
    assert.deepStrictEqual(analysis[0]?.availableDraftPicks, [
      { round: 1, cost: 0, pick: 0 },
      { round: 2, cost: 0, pick: 0 },
    ]);
    assert.deepStrictEqual(analysis[0]?.positionalRanks, [{ position: "QB", rank: 3 }]);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads recommended trade partners", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      fantasy_content: {
        league: {
          league_key: leagueKey,
          recommended_trade_partners: [{ recommended_trade_partner: { team_key: otherTeamKey } }],
        },
      },
    }),
  );

  return Effect.gen(function* () {
    const partners = yield* Yahoo.leagues.tradePartners({ leagueKey });
    assert.deepStrictEqual(partners, [{ teamKey: otherTeamKey }]);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("reads the mobile dashboard and sorts league summaries", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      my_league_keys: [leagueKey, "466.l.4001"],
      my_leagues_and_team_keys: {
        "466.l.4001": {
          league_key: "466.l.4001",
          league_name: "Second League",
          team_keys: ["466.l.4001.t.1"],
          fantasy_game_code: "nfl",
          season: 2026,
          week: 9,
          start_week: 1,
          end_week: 17,
          start_date: "2026-09-01",
          end_date: "2027-01-04",
          draft_status: "postdraft",
          league_type: "private",
          uses_playoffs: true,
          playoff_start_week: 15,
          is_auction: false,
          is_best_ball_league: false,
          is_guillotine: false,
          uses_median_score: false,
          is_private_chat_available: true,
          scoring_config: { scoring_type: "head", scoring_label: "H2H" },
        },
        [leagueKey]: {
          league_key: leagueKey,
          league_name: "First League",
          team_keys: [teamKey],
          fantasy_game_code: "nfl",
          season: 2026,
          week: 9,
          start_week: 1,
          end_week: 17,
          start_date: "2026-09-01",
          end_date: "2027-01-04",
          draft_status: "postdraft",
          league_type: "private",
          uses_playoffs: true,
          playoff_start_week: 15,
          is_auction: false,
          is_best_ball_league: false,
          is_guillotine: false,
          uses_median_score: false,
          is_private_chat_available: true,
          scoring_config: { scoring_type: "head", scoring_label: "H2H" },
        },
      },
    }),
  );

  return Effect.gen(function* () {
    const dashboard = yield* Yahoo.statcloud.dashboard({ includeBestBallLeagues: false });
    assert.strictEqual(dashboard.leagues[0]?.leagueKey, leagueKey);
    assert.strictEqual(dashboard.leagues[0]?.scoringLabel, "H2H");
    assert.strictEqual(dashboard.leagueKeys[0], leagueKey);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("proposes a draft-pick-only trade with the observed XML body", () => {
  const recording = recordingClient((call) =>
    call.url.includes("/getCrumb")
      ? jsonResponse(crumbPayload)
      : jsonResponse({
          fantasy_content: {
            transaction: {
              type: "pending_trade",
              transaction_key: "466.l.4000.pt.9",
            },
          },
        }),
  );

  return Effect.gen(function* () {
    const receipt = yield* Yahoo.trades.propose({
      leagueKey,
      traderTeamKey: teamKey,
      tradeeTeamKey: otherTeamKey,
      sendPicks: [{ round: 1 }],
      receivePicks: [{ round: 2 }],
    });
    const call = recording.calls[1];
    if (call === undefined) {
      return yield* Effect.die("expected a crumb request and a write request");
    }
    assert.strictEqual(
      call.url,
      "https://pub-api-android-rw.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/transactions?format=json_f&crumb=canary-crumb-value",
    );
    assert.deepStrictEqual(receipt, {
      status: "accepted",
      transactionKey: "466.l.4000.pt.9",
    });
    assert.match(
      yield* Effect.promise(() => call.body),
      /<picks><pick><source_team_key>466\.l\.4000\.t\.1<\/source_team_key><destination_team_key>466\.l\.4000\.t\.2<\/destination_team_key><round>1<\/round><\/pick>/u,
    );
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("finds the pending key in a draft-pick receipt nested under league", () => {
  const recording = recordingClient((call) =>
    call.url.includes("/getCrumb")
      ? jsonResponse(crumbPayload)
      : jsonResponse(
          {
            fantasy_content: {
              league: {
                league_key: leagueKey,
                transactions: [
                  {
                    transaction: {
                      transaction_key: "466.l.4000.pt.91",
                      type: "pending_trade",
                      status: "proposed",
                      picks: [
                        {
                          pick: {
                            source_team_key: teamKey,
                            destination_team_key: otherTeamKey,
                            original_team_key: teamKey,
                            round: "1",
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
          201,
        ),
  );

  return Effect.gen(function* () {
    const receipt = yield* Yahoo.trades.propose({
      leagueKey,
      traderTeamKey: teamKey,
      tradeeTeamKey: otherTeamKey,
      sendPicks: [{ round: 1 }],
      receivePicks: [{ round: 1 }],
    });
    assert.deepStrictEqual(receipt, {
      status: "accepted",
      transactionKey: "466.l.4000.pt.91",
    });
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("keeps the provider's draft-pick trade refusal wording", () => {
  const refusal =
    "Player Devin Cooley is in a IR position on your roster, but is no longer on the real-life IR.  Please edit your lineup to activate this player from your IR and then attempt your transaction again.";
  const recording = recordingClient((call) =>
    call.url.includes("/getCrumb")
      ? jsonResponse(crumbPayload)
      : jsonResponse(
          {
            error: {
              "xml:lang": "en-us",
              "yahoo:uri": "/fantasy/v2/league/466.l.4000/transactions",
              description: refusal,
              detail: null,
            },
          },
          400,
        ),
  );

  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      Yahoo.trades.propose({
        leagueKey,
        traderTeamKey: teamKey,
        tradeeTeamKey: otherTeamKey,
        sendPicks: [{ round: 1 }],
        receivePicks: [{ round: 1 }],
      }),
    );
    assert.strictEqual(error._tag, "BadRequest");
    assert.strictEqual(error.message, refusal);
  }).pipe(Effect.provide(testLayer(recording.client)));
});
