import * as Schema from "effect/Schema";

import * as API from "#yahoo/api.ts";
import type { YahooReadError } from "#yahoo/errors.ts";
import { decodeScheduleByDate, decodeScoreboardGame } from "#yahoo/internal/schedule.ts";
import type { YahooScheduleGame, YahooScoreboardGame } from "#yahoo/internal/schedule.ts";
import { YahooDate, YahooGameKey } from "#yahoo/keys.ts";

const TimeZone = Schema.NonEmptyString;

export const ByDateRequest = Schema.Struct({
  sport: YahooGameKey,
  date: YahooDate,
  timeZone: TimeZone,
});
export type ByDateRequest = typeof ByDateRequest.Type;

export type ByDateResponse = ReadonlyArray<YahooScheduleGame>;

export const byDate: API.OperationMethod<
  ByDateRequest,
  ByDateResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_schedule_by_date",
  input: ByDateRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "graphite",
    method: "GET",
    format: "none",
    path: "/v1/query/shangrila/leagueGameIdsByDate",
    query: {
      lang: "en-US",
      region: "US",
      tz: input.timeZone,
      ysp_platform: "next-app-sports",
      leagues: input.sport,
      dates: input.date,
      season: input.date.slice(0, 4),
    },
  }),
  decode: (payload) => decodeScheduleByDate(payload),
});

export const GameRequest = Schema.Struct({
  gameId: Schema.NonEmptyString,
  season: Schema.Int.check(Schema.isGreaterThan(1900)),
  timeZone: TimeZone,
});
export type GameRequest = typeof GameRequest.Type;

export type GameResponse = ReadonlyArray<YahooScoreboardGame>;

export const game: API.OperationMethod<
  GameRequest,
  GameResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_scoreboard_game",
  input: GameRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "graphite",
    method: "GET",
    format: "none",
    path: "/v1/query/shangrila/scoreboardGame",
    query: {
      lang: "en-US",
      region: "US",
      tz: input.timeZone,
      ysp_platform: "next-app-sports",
      gameId: input.gameId,
      season: String(input.season),
    },
  }),
  decode: (payload) => decodeScoreboardGame(payload),
});
