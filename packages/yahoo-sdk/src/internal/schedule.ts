import { Effect, Schema } from "effect";

import { decodePayload } from "#yahoo/decode.ts";
import { YahooParseError } from "#yahoo/errors.ts";

export function decodeScheduleByDate(
  payload: unknown,
): Effect.Effect<ReadonlyArray<YahooScheduleGame>, YahooParseError> {
  return decodePayload(ScheduleByDatePayload, payload, "read_schedule_by_date").pipe(
    Effect.map((decoded) =>
      decoded.data.leagues.flatMap((league) =>
        league.games.map((game) => ({
          gameId: game.gameId,
          startTime: game.startTime,
          status: game.status,
        })),
      ),
    ),
  );
}

export function decodeScoreboardGame(
  payload: unknown,
): Effect.Effect<ReadonlyArray<YahooScoreboardGame>, YahooParseError> {
  return decodePayload(ScoreboardGamePayload, payload, "read_scoreboard_game").pipe(
    Effect.map((decoded) =>
      decoded.data.games.map((game) => ({
        awayTeamId: game.awayTeamId,
        homeTeamId: game.homeTeamId,
        startTime: game.startTime,
        gameStatus: game.gameStatus,
      })),
    ),
  );
}

export type YahooScheduleGame = {
  readonly gameId: string;
  readonly startTime: string;
  readonly status: string;
};

export type YahooScoreboardGame = {
  readonly awayTeamId: string;
  readonly homeTeamId: string;
  readonly startTime: string;
  readonly gameStatus: string;
};

const ScheduleGamePayload = Schema.Struct({
  gameId: Schema.NonEmptyString,
  startTime: Schema.NonEmptyString,
  status: Schema.NonEmptyString,
});

const ScheduleByDatePayload = Schema.Struct({
  data: Schema.Struct({
    leagues: Schema.Array(
      Schema.Struct({
        games: Schema.Array(ScheduleGamePayload),
      }),
    ),
  }),
});

const ScoreboardGamePayload = Schema.Struct({
  data: Schema.Struct({
    games: Schema.Array(
      Schema.Struct({
        awayTeamId: Schema.NonEmptyString,
        homeTeamId: Schema.NonEmptyString,
        startTime: Schema.NonEmptyString,
        gameStatus: Schema.NonEmptyString,
      }),
    ),
  }),
});
