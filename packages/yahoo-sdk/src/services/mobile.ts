import * as Schema from "effect/Schema";

import * as API from "#yahoo/api.ts";
import type { YahooReadError } from "#yahoo/errors.ts";
import {
  decodeGames,
  decodePlayerCards,
  decodePlayerGameLog,
  decodePlayerSeasonStats,
} from "#yahoo/internal/mobile.ts";
import type {
  YahooMobileGame,
  YahooPlayerCard,
  YahooPlayerGameLog,
  YahooPlayerSeasonStats,
} from "#yahoo/internal/mobile.ts";
import { YahooLeagueKey, YahooPlayerKey, YahooWeek } from "#yahoo/keys.ts";

const SubView = Schema.Literals(["overview", "gameLog", "seasonStats", "leagueAvailability"]);

export const GamesRequest = Schema.Struct({
  league: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(80)),
  ),
  week: Schema.optional(YahooWeek),
});
export type GamesRequest = typeof GamesRequest.Type;

export type GamesResponse = ReadonlyArray<YahooMobileGame>;

export const games: API.OperationMethod<
  GamesRequest,
  GamesResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_mobile_games",
  input: GamesRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "mobile",
    method: "GET",
    path: "/v2/fantasy-android/getGames",
    query: {
      league: input.league,
      ...(input.week === undefined ? {} : { week: String(input.week) }),
    },
  }),
  decode: (payload) => decodeGames(payload),
});

export const PlayerCardsRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
  playerKeys: Schema.Array(YahooPlayerKey).pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(25)),
    Schema.check(
      Schema.makeFilter((keys: ReadonlyArray<string>) => new Set(keys).size === keys.length),
    ),
  ),
  subViews: Schema.optional(Schema.Array(SubView)),
});
export type PlayerCardsRequest = typeof PlayerCardsRequest.Type;

export type PlayerCardsResponse = ReadonlyArray<YahooPlayerCard>;

export const playerCards: API.OperationMethod<
  PlayerCardsRequest,
  PlayerCardsResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_mobile_player_cards",
  input: PlayerCardsRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "mobile",
    method: "GET",
    path: "/v2/fantasy-android/getFantasyPlayerCards",
    query: {
      leagueKey: input.leagueKey,
      playerKeys: input.playerKeys.join(","),
      subviews: (
        input.subViews ?? ["overview", "gameLog", "seasonStats", "leagueAvailability"]
      ).join(","),
    },
  }),
  decode: (payload) => decodePlayerCards(payload),
});

export const PlayerGameLogRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
  playerKey: YahooPlayerKey,
});
export type PlayerGameLogRequest = typeof PlayerGameLogRequest.Type;

export type PlayerGameLogResponse = YahooPlayerGameLog;

export const playerGameLog: API.OperationMethod<
  PlayerGameLogRequest,
  PlayerGameLogResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_mobile_player_game_log",
  input: PlayerGameLogRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "mobile",
    method: "GET",
    path: "/v2/fantasy-android/getFantasyPlayerGameLog",
    query: { leagueKey: input.leagueKey, playerKey: input.playerKey },
  }),
  decode: (payload) => decodePlayerGameLog(payload),
});

export const PlayerSeasonStatsRequest = Schema.Struct({
  leagueKey: YahooLeagueKey,
  playerKey: YahooPlayerKey,
});
export type PlayerSeasonStatsRequest = typeof PlayerSeasonStatsRequest.Type;

export type PlayerSeasonStatsResponse = YahooPlayerSeasonStats;

export const playerSeasonStats: API.OperationMethod<
  PlayerSeasonStatsRequest,
  PlayerSeasonStatsResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_mobile_player_season_stats",
  input: PlayerSeasonStatsRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "mobile",
    method: "GET",
    path: "/v2/fantasy-android/getFantasyPlayerSeasonStats",
    query: { leagueKey: input.leagueKey, playerKey: input.playerKey },
  }),
  decode: (payload) => decodePlayerSeasonStats(payload),
});
