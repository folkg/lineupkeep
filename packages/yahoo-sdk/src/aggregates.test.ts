import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  recordedAggregateDiscover,
  recordedAggregatePlayerSearch,
  recordedAggregateRoster,
} from "./aggregateFixturesTest.ts";
import * as Yahoo from "./index.ts";
import { jsonResponse, recordingClient, testLayer } from "./testSupportTest.ts";

const leagueKey = "470.l.70271";

it.effect("discovers a recorded live aggregate response whose leagues are not wrapped", () => {
  const recording = recordingClient(() => jsonResponse(recordedAggregateDiscover));

  return Effect.gen(function* () {
    const leagues = yield* Yahoo.leagues.discover({});

    assert.strictEqual(leagues.length, 1);
    assert.strictEqual(leagues[0]?.leagueKey, leagueKey);
    assert.strictEqual(leagues[0]?.gameKey, "nfl");
    assert.strictEqual(leagues[0]?.season, 2026);
    assert.strictEqual(leagues[0]?.teams.length, 1);
    assert.strictEqual(leagues[0]?.teams[0]?.teamKey, "470.l.70271.t.4");
    assert.strictEqual(leagues[0]?.teams[0]?.isOwnedByCurrentLogin, true);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect(
  "searches players in a recorded live aggregate response whose leagues are not wrapped",
  () => {
    const recording = recordingClient(() => jsonResponse(recordedAggregatePlayerSearch));

    return Effect.gen(function* () {
      const groups = yield* Yahoo.players.search({
        leagueKeys: [leagueKey],
        availability: "all",
        sort: "ownership",
        sortType: "season",
        limit: 10,
      });

      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0]?.leagueKey, leagueKey);
      assert.strictEqual(groups[0]?.players.length, 3);
      assert.match(groups[0]?.players[0]?.playerKey ?? "", /^[0-9]+\.p\.[0-9]+$/u);
      assert.strictEqual(groups[0]?.players[0]?.proTeamKey, "nfl.t.2");
      assert.strictEqual(groups[0]?.players[0]?.proTeamAbbreviation, "Buf");
    }).pipe(Effect.provide(testLayer(recording.client)));
  },
);

it.effect("reads a recorded live league roster whose games played object is empty", () => {
  const recording = recordingClient(() => jsonResponse(recordedAggregateRoster));

  return Effect.gen(function* () {
    const rosters = yield* Yahoo.rosters.forLeagues({ leagueKeys: [leagueKey] });

    assert.strictEqual(rosters.length, 1);
    assert.strictEqual(rosters[0]?.teamKey, "470.l.70271.t.4");
    assert.strictEqual(rosters[0]?.leagueKey, leagueKey);
    assert.strictEqual(rosters[0]?.gamesPlayed, undefined);
    assert.strictEqual(rosters[0]?.players.length, 3);
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("refuses a malformed aggregate league entry", () => {
  const recording = recordingClient(() =>
    jsonResponse({
      fantasy_content: {
        users: [
          {
            games: [
              {
                code: "nfl",
                season: "2026",
                leagues: [{ league_key: leagueKey }],
              },
            ],
          },
        ],
      },
    }),
  );

  return Effect.gen(function* () {
    const error = yield* Effect.flip(Yahoo.leagues.discover({}));

    assert.strictEqual(error._tag, "YahooParseError");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("refuses a malformed aggregate player entry", () => {
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
                    players: [{ player_key: "470.p.1" }],
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
    const error = yield* Effect.flip(
      Yahoo.players.search({
        leagueKeys: [leagueKey],
        availability: "all",
        sort: "ownership",
        sortType: "season",
        limit: 10,
      }),
    );

    assert.strictEqual(error._tag, "YahooParseError");
  }).pipe(Effect.provide(testLayer(recording.client)));
});

it.effect("refuses malformed games played in an aggregate roster", () => {
  const malformed = structuredClone(recordedAggregateRoster);
  const league = malformed.fantasy_content.users[0]?.games[0]?.leagues[0];
  const team = league?.teams[0];
  if (team === undefined) {
    return Effect.die("the recorded fixture has no team");
  }
  team.games_played = {
    games_played_by_position_type: {
      position_type: "O",
      games_played: {
        games_played_by_position: {
          position: "QB",
          games_played: { played: "many", max: 17, projected: 1 },
        },
      },
    },
  };
  const recording = recordingClient(() => jsonResponse(malformed));

  return Effect.gen(function* () {
    const error = yield* Effect.flip(Yahoo.rosters.forLeagues({ leagueKeys: [leagueKey] }));

    assert.strictEqual(error._tag, "YahooParseError");
  }).pipe(Effect.provide(testLayer(recording.client)));
});
