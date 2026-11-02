import { DateTime, Effect, Schema } from "effect";

import type {
  GameSourceGame,
  GameSourceLeagueWeek,
  GameSourceShape,
  GameSourceTeam,
} from "#contexts/connections/GameSource.ts";
import {
  GameSourceRequestFailed,
  GameSourceResponseInvalid,
} from "#contexts/connections/GameSource.ts";
import type { ProfessionalGameStatus } from "#contexts/connections/ProfessionalGame.ts";
import { PublicInternet } from "#runtime/PublicInternet.ts";

const sourceKey = "nhl-web";
const apiOrigin = new URL("https://api-web.nhle.com");
const userAgent = "lineupkeep/0.1 (professional schedule reference)";
const weekDays = 7;
const requestTimeoutMillis = 15_000;
const maximumResponseBytes = 262_144;

type GameSourceUnavailable = GameSourceRequestFailed | GameSourceResponseInvalid;

export const nhlGameSource: Effect.Effect<GameSourceShape, never, PublicInternet> = Effect.gen(
  function* () {
    const internet = yield* PublicInternet;

    const readLeagueWeek: GameSourceShape["readLeagueWeek"] = Effect.fn(
      "NhlGameSource.readLeagueWeek",
    )(function* (input) {
      const url = scheduleUrl(input.weekStart);
      const response = yield* Effect.scoped(
        internet
          .request(
            new Request(url, {
              method: "GET",
              headers: { accept: "application/json", "user-agent": userAgent },
            }),
            { timeoutMs: requestTimeoutMillis, maxResponseBytes: maximumResponseBytes },
          )
          .pipe(
            Effect.mapError((error) =>
              GameSourceRequestFailed.make({
                source: sourceKey,
                detail: error.reason ?? error._tag,
              }),
            ),
          ),
      );

      if (!response.ok) {
        yield* Effect.tryPromise({
          try: () => response.body?.cancel() ?? Promise.resolve(),
          catch: () => GameSourceRequestFailed.make({ source: sourceKey }),
        }).pipe(Effect.ignore);
        return yield* GameSourceRequestFailed.make({ source: sourceKey, status: response.status });
      }

      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => GameSourceRequestFailed.make({ source: sourceKey }),
      });
      const decoded = yield* Schema.decodeEffect(Schema.fromJsonString(SchedulePayload))(text).pipe(
        Effect.mapError(() =>
          GameSourceResponseInvalid.make({ source: sourceKey, field: "payload" }),
        ),
      );
      const games = yield* Effect.forEach(decoded.gameWeek.flatMap(gameDayEntries), (entry) =>
        gameOf(entry.date, entry.game),
      );
      return {
        league: input.league,
        weekStart: input.weekStart,
        weekEnd: lastGameDay(decoded.gameWeek, input.weekStart),
        games,
      } satisfies GameSourceLeagueWeek;
    });

    return {
      key: sourceKey,
      capabilities: {
        coverage: [{ league: "nhl", sport: "hockey", teamCount: 32 }],
        weekDays,
        publishesStartTime: true,
        publishesVenueTimeZone: true,
        publishesStatus: true,
        maximumResponseBytes,
      },
      readLeagueWeek,
    };
  },
);

const TeamPayload = Schema.Struct({
  id: Schema.Int,
  abbrev: Schema.NonEmptyString,
  placeName: Schema.Struct({ default: Schema.NonEmptyString }),
  commonName: Schema.optional(Schema.Struct({ default: Schema.NonEmptyString })),
});

const ScheduleDay = Schema.Struct({
  date: Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u))),
  games: Schema.Array(
    Schema.Struct({
      id: Schema.Int,
      startTimeUTC: Schema.optional(Schema.DateTimeUtcFromString),
      venueTimezone: Schema.optional(Schema.NonEmptyString),
      venue: Schema.optional(Schema.Struct({ default: Schema.NonEmptyString })),
      gameState: Schema.optional(Schema.String),
      gameScheduleState: Schema.String,
      homeTeam: TeamPayload,
      awayTeam: TeamPayload,
    }),
  ),
});

const SchedulePayload = Schema.Struct({
  gameWeek: Schema.Array(ScheduleDay),
});

type ScheduleGame = (typeof ScheduleDay.Type.games)[number];

function scheduleUrl(weekStart: string): URL {
  const url = new URL(`/v1/schedule/${weekStart}`, apiOrigin);
  if (url.origin !== apiOrigin.origin || url.pathname !== `/v1/schedule/${weekStart}`) {
    throw new Error("The schedule request escaped its fixed origin");
  }
  return url;
}

function gameDayEntries(day: typeof ScheduleDay.Type): ReadonlyArray<{
  readonly date: string;
  readonly game: ScheduleGame;
}> {
  return day.games.map((game) => ({ date: day.date, game }));
}

function gameOf(
  date: string,
  game: ScheduleGame,
): Effect.Effect<GameSourceGame, GameSourceUnavailable> {
  return Effect.gen(function* () {
    const startTime = yield* startTimeOf(game);
    return {
      id: String(game.id),
      date,
      startTime,
      venue: game.venue?.default ?? null,
      status: statusOf(game),
      home: teamOf(game.homeTeam),
      away: teamOf(game.awayTeam),
    } satisfies GameSourceGame;
  });
}

function startTimeOf(
  game: ScheduleGame,
): Effect.Effect<GameSourceGame["startTime"], GameSourceResponseInvalid> {
  if (game.startTimeUTC === undefined && game.venueTimezone === undefined) {
    return Effect.succeed(null);
  }
  if (game.startTimeUTC === undefined || game.venueTimezone === undefined) {
    return GameSourceResponseInvalid.make({ source: sourceKey, field: "startTimeUTC" });
  }
  return Effect.succeed({
    instant: DateTime.toUtc(game.startTimeUTC),
    timeZone: game.venueTimezone,
  });
}

function teamOf(team: typeof TeamPayload.Type): GameSourceTeam {
  const place = team.placeName.default;
  const common = team.commonName?.default;
  return {
    identifier: String(team.id),
    abbreviation: team.abbrev,
    name: common === undefined ? place : `${place} ${common}`,
  };
}

function statusOf(game: ScheduleGame): ProfessionalGameStatus {
  switch (game.gameScheduleState) {
    case "PPD":
      return "postponed";
    case "CNCL":
      return "cancelled";
    case "OK":
      break;
    default:
      return "unknown";
  }
  switch (game.gameState ?? "") {
    case "LIVE":
    case "CRIT":
      return "in_progress";
    case "FINAL":
    case "OFF":
    case "OVER":
      return "final";
    case "FUT":
    case "PRE":
      return "scheduled";
    default:
      return "unknown";
  }
}

function lastGameDay(days: ReadonlyArray<typeof ScheduleDay.Type>, weekStart: string): string {
  const last = days.at(-1);
  return last === undefined ? addDays(weekStart, weekDays - 1) : last.date;
}

function addDays(date: string, days: number): string {
  const parsed = DateTime.makeUnsafe(`${date}T00:00:00.000Z`);
  return DateTime.formatIsoDate(DateTime.add(parsed, { days }));
}
