import { readFileSync } from "node:fs";

import { assert, it } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";

import {
  GameSourceRequestFailed,
  GameSourceResponseInvalid,
} from "#contexts/connections/GameSource.ts";
import { PublicInternet } from "#runtime/PublicInternet.ts";

import { nhlGameSource } from "./NhlGameSource.ts";

const leagueWeek = fixture("league-week.json");
const relocatedWeek = fixture("relocated-week.json");

it.effect("reads a whole league week as games with identifiers, times, venues and statuses", () => {
  const internet = recordingInternet(() => jsonResponse(leagueWeek));
  return Effect.gen(function* () {
    const source = yield* nhlGameSource;
    const week = yield* source.readLeagueWeek({ league: "nhl", weekStart: "2026-11-01" });

    assert.strictEqual(week.weekStart, "2026-11-01");
    assert.strictEqual(week.weekEnd, "2026-11-07");
    assert.strictEqual(week.games.length, 50);
    assert.strictEqual(new Set(week.games.map((game) => game.date)).size, 7);
    assert.isTrue(
      week.games.every((game) => game.date >= week.weekStart && game.date <= week.weekEnd),
    );
    assert.isTrue(week.games.every((game) => game.home.identifier !== game.away.identifier));
    assert.strictEqual(
      new Set(week.games.flatMap((game) => [game.home.abbreviation, game.away.abbreviation])).size,
      32,
    );

    const opener = gameOf(week.games, "2026020227");
    assert.deepStrictEqual(opener.home, {
      identifier: "12",
      abbreviation: "CAR",
      name: "Carolina Hurricanes",
    });
    assert.deepStrictEqual(opener.away, {
      identifier: "52",
      abbreviation: "WPG",
      name: "Winnipeg Jets",
    });
    assert.strictEqual(opener.venue, "Lenovo Center");
    assert.strictEqual(opener.status, "in_progress");
    assert.strictEqual(
      opener.startTime === null ? undefined : DateTime.formatIso(opener.startTime.instant),
      "2026-11-01T18:00:00.000Z",
    );
    assert.strictEqual(opener.startTime?.timeZone, "US/Eastern");

    const future = gameOf(week.games, "2026020265");
    assert.strictEqual(future.status, "scheduled");

    assert.strictEqual(internet.calls.length, 1);
    const call = internet.calls[0];
    assert.strictEqual(call?.url.href, "https://api-web.nhle.com/v1/schedule/2026-11-01");
    assert.strictEqual(call?.method, "GET");
    assert.strictEqual(
      call?.headers["user-agent"],
      "lineupkeep/0.1 (professional schedule reference)",
    );
    assert.strictEqual(call?.options?.maxResponseBytes, 262_144);
  }).pipe(Effect.provide(internet));
});

it.effect("serves a postponed and a cancelled game with their own statuses", () => {
  const internet = recordingInternet(() => jsonResponse(relocatedWeek));
  return Effect.gen(function* () {
    const source = yield* nhlGameSource;
    const week = yield* source.readLeagueWeek({ league: "nhl", weekStart: "2026-11-01" });

    assert.deepStrictEqual(
      week.games.map((game) => [game.id, game.date, game.status]),
      [
        ["2026020301", "2026-11-01", "postponed"],
        ["2026020302", "2026-11-01", "cancelled"],
        ["2026020303", "2026-11-01", "scheduled"],
        ["2026020304", "2026-11-02", "final"],
      ],
    );
    const postponed = gameOf(week.games, "2026020301");
    assert.strictEqual(postponed.home.name, "Toronto Maple Leafs");
    assert.strictEqual(postponed.venue, "Scotiabank Arena");
    assert.strictEqual(postponed.startTime?.timeZone, "America/Toronto");
  }).pipe(Effect.provide(internet));
});

it.effect("reports an unrecognised schedule state as unknown rather than on", () => {
  const internet = recordingInternet(() =>
    jsonResponse(
      weekPayload([
        game({ id: 1, gameScheduleState: "SUSP", gameState: "FUT" }),
        game({ id: 2, gameScheduleState: "TBD", gameState: "FUT" }),
        game({ id: 3, gameScheduleState: "XYZ", gameState: "LIVE" }),
        game({ id: 4, gameScheduleState: "OK", gameState: "RETIRED" }),
      ]),
    ),
  );
  return Effect.gen(function* () {
    const source = yield* nhlGameSource;
    const week = yield* source.readLeagueWeek({ league: "nhl", weekStart: "2026-11-01" });

    assert.deepStrictEqual(
      week.games.map((game) => game.status),
      ["unknown", "unknown", "unknown", "unknown"],
    );
  }).pipe(Effect.provide(internet));
});

it.effect("fails the read when a day publishes no games key", () => {
  const internet = recordingInternet(() => jsonResponse({ gameWeek: [{ date: "2026-11-01" }] }));
  return Effect.gen(function* () {
    const source = yield* nhlGameSource;
    const error = yield* Effect.flip(
      source.readLeagueWeek({ league: "nhl", weekStart: "2026-11-01" }),
    );

    assert.instanceOf(error, GameSourceResponseInvalid);
    assert.strictEqual(error.field, "payload");
  }).pipe(Effect.provide(internet));
});

it.effect("reads an empty league week as a fact with no games", () => {
  const internet = recordingInternet(() =>
    jsonResponse({
      gameWeek: [
        "2026-11-01",
        "2026-11-02",
        "2026-11-03",
        "2026-11-04",
        "2026-11-05",
        "2026-11-06",
        "2026-11-07",
      ].map((date) => ({ date, games: [] })),
    }),
  );
  return Effect.gen(function* () {
    const source = yield* nhlGameSource;
    const week = yield* source.readLeagueWeek({ league: "nhl", weekStart: "2026-11-01" });

    assert.deepStrictEqual(week.games, []);
    assert.strictEqual(week.weekEnd, "2026-11-07");
  }).pipe(Effect.provide(internet));
});

it.effect("reports a failed request with its status and leaves no games behind", () => {
  const internet = recordingInternet(() => new Response("unavailable", { status: 503 }));
  return Effect.gen(function* () {
    const source = yield* nhlGameSource;
    const error = yield* Effect.flip(
      source.readLeagueWeek({ league: "nhl", weekStart: "2026-11-01" }),
    );

    assert.instanceOf(error, GameSourceRequestFailed);
    assert.strictEqual(error.status, 503);
  }).pipe(Effect.provide(internet));
});

it.effect("refuses a start instant that arrives without its venue time zone", () => {
  const internet = recordingInternet(() =>
    jsonResponse(
      weekPayload([
        game({ id: 1, gameScheduleState: "OK", gameState: "FUT", venueTimezone: null }),
      ]),
    ),
  );
  return Effect.gen(function* () {
    const source = yield* nhlGameSource;
    const error = yield* Effect.flip(
      source.readLeagueWeek({ league: "nhl", weekStart: "2026-11-01" }),
    );

    assert.instanceOf(error, GameSourceResponseInvalid);
    assert.strictEqual(error.field, "startTimeUTC");
  }).pipe(Effect.provide(internet));
});

function gameOf<Game extends { readonly id: string }>(
  games: ReadonlyArray<Game>,
  id: string,
): Game {
  const found = games.find((game) => game.id === id);
  if (found === undefined) {
    throw new Error(`The league week has no game ${id}`);
  }
  return found;
}

type RecordedRequest = {
  readonly url: URL;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly options: Parameters<PublicInternet["Service"]["request"]>[1];
};

it.effect("reads the response body before the request scope closes", () => {
  const internet = scopedInternet(() => jsonResponse(leagueWeek));
  return Effect.gen(function* () {
    const source = yield* nhlGameSource;
    const week = yield* source.readLeagueWeek({ league: "nhl", weekStart: "2026-11-01" });

    assert.strictEqual(week.games.length, 50);
  }).pipe(Effect.provide(internet));
});

function recordingInternet(respond: () => Response): Layer.Layer<PublicInternet> & {
  readonly calls: ReadonlyArray<RecordedRequest>;
} {
  const calls: Array<RecordedRequest> = [];
  const layer = Layer.succeed(PublicInternet)({
    request: (request, options) =>
      Effect.sync(() => {
        calls.push({
          url: new URL(request.url),
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
          options,
        });
        return respond();
      }),
  });
  return Object.assign(layer, { calls });
}

function scopedInternet(respond: () => Response): Layer.Layer<PublicInternet> {
  return Layer.succeed(PublicInternet)({
    request: () =>
      Effect.gen(function* () {
        const signal = yield* Effect.abortSignal;
        const response = respond();
        const body = response.body?.pipeThrough(new TransformStream(), { signal });
        return new Response(body ?? null, { status: response.status, headers: response.headers });
      }),
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

function weekPayload(games: ReadonlyArray<unknown>): unknown {
  const dates = [
    "2026-11-01",
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
  ];
  return {
    gameWeek: dates.map((date, index) => ({ date, games: index === 0 ? games : [] })),
  };
}

function game(input: {
  readonly id: number;
  readonly gameScheduleState: string;
  readonly gameState: string;
  readonly venueTimezone?: string | null;
}): unknown {
  const timeZone = input.venueTimezone === undefined ? "America/New_York" : input.venueTimezone;
  return {
    id: input.id,
    startTimeUTC: "2026-11-01T23:00:00Z",
    ...(timeZone === null ? {} : { venueTimezone: timeZone }),
    venue: { default: "Synthetic Arena" },
    gameState: input.gameState,
    gameScheduleState: input.gameScheduleState,
    awayTeam: {
      id: 6,
      abbrev: "BOS",
      placeName: { default: "Boston" },
      commonName: { default: "Bruins" },
    },
    homeTeam: {
      id: 10,
      abbrev: "TOR",
      placeName: { default: "Toronto" },
      commonName: { default: "Maple Leafs" },
    },
  };
}
