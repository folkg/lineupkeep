import { readFileSync } from "node:fs";

import { assert, it } from "@effect/vitest";
import { Array, DateTime, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";

import { GameSourceRegistry, gameSourceRegistryOf } from "#contexts/connections/GameSource.ts";
import {
  ProfessionalCalendar,
  ProfessionalCalendarUnavailable,
  ProfessionalGameFactStale,
} from "#contexts/connections/ProfessionalCalendar.ts";
import type { ProfessionalGameFact } from "#contexts/connections/ProfessionalCalendar.ts";
import { PublicInternet } from "#runtime/PublicInternet.ts";

import { ConnectionsDatabaseTest } from "./ConnectionsDatabaseTest.ts";
import { nhlGameSource } from "./game-sources/nhl/NhlGameSource.ts";
import { countGamesForTeam, isLeagueOffNight, leagueGamesByDate } from "./LeagueSchedule.ts";
import { ProfessionalCalendarLive } from "./ProfessionalCalendarLive.ts";
import { ScheduleObservationRepository } from "./ScheduleObservationRepository.ts";

const leagueWeek = fixture("league-week.json");
const relocatedWeek = fixture("relocated-week.json");
const openerId = "2026020227";
const carolinaKey = "nhl.t.7";
const winnipegKey = "nhl.t.28";
const edmontonKey = "nhl.t.6";
const observedAt = DateTime.makeUnsafe("2026-11-01T12:00:00.000Z");

const ScheduleObservationRepositoryTest = ScheduleObservationRepository.layer.pipe(
  Layer.provide(ConnectionsDatabaseTest),
);

it.effect("counts a real hockey week's games and marks its off nights", () => {
  const calls: Array<URL> = [];
  return Effect.gen(function* () {
    const calendar = yield* ProfessionalCalendar;
    yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));

    const window = yield* calendar.readGames({
      league: "nhl",
      from: "2026-11-01",
      to: "2026-11-07",
      freshness: "calendar",
    });

    assert.strictEqual(window.teamCount, 32);
    const byDate = leagueGamesByDate(window.games.map((fact) => fact.game));
    assert.deepStrictEqual(
      [...byDate.keys()].map((date) => [date, byDate.get(date)?.games]),
      [
        ["2026-11-01", 5],
        ["2026-11-02", 4],
        ["2026-11-03", 11],
        ["2026-11-04", 4],
        ["2026-11-05", 11],
        ["2026-11-06", 3],
        ["2026-11-07", 12],
      ],
    );
    assert.deepStrictEqual(
      [...byDate.values()].map((entry) =>
        isLeagueOffNight({ teamsPlaying: entry.teamsPlaying, teamCount: window.teamCount }),
      ),
      [true, true, false, true, false, true, false],
    );

    assert.strictEqual(
      countGamesForTeam(
        window.games.map((fact) => fact.game),
        edmontonKey,
      ),
      4,
    );
  }).pipe(
    Effect.provide(
      calendarLayer(
        (weekStart) =>
          weekStart === "2026-11-01" ? jsonResponse(leagueWeek) : jsonResponse({ gameWeek: [] }),
        calls,
      ),
    ),
  );
});

it.effect("produces a fact for every game of one league-week request with teams resolved", () => {
  const calls: Array<URL> = [];
  return Effect.gen(function* () {
    const calendar = yield* ProfessionalCalendar;
    const store = yield* ScheduleObservationRepository;
    yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));

    const week = yield* calendar.readLeagueWeek({
      league: "nhl",
      weekStart: "2026-11-01",
      freshness: "calendar",
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]?.href, "https://api-web.nhle.com/v1/schedule/2026-11-01");
    assert.strictEqual(week.games.length, 50);
    assert.strictEqual(week.weekEnd, "2026-11-07");
    assert.deepStrictEqual(week.unresolvedTeams, []);
    assert.strictEqual(DateTime.formatIso(week.observedAt), "2026-11-01T12:00:00.000Z");

    const opener = factOf(week.games, openerId);
    assert.strictEqual(opener.game.home.providerTeamKey, carolinaKey);
    assert.strictEqual(opener.game.away.providerTeamKey, winnipegKey);
    assert.strictEqual(opener.game.home.sourceTeamAbbreviation, "CAR");
    assert.strictEqual(opener.game.startTime?.timeZone, "US/Eastern");
    assert.strictEqual(opener.game.venue, "Lenovo Center");

    const stored = yield* store.readProfessionalGames({ from: "2026-11-01", to: "2026-11-07" });
    assert.strictEqual(stored.length, 50);
    assert.isTrue(
      stored.every(
        (row) => row.value.home.providerTeamKey !== null && row.value.away.providerTeamKey !== null,
      ),
    );
  }).pipe(Effect.provide(calendarLayer(() => jsonResponse(leagueWeek), calls)));
});

it.effect("keeps one row per game and window and never replaces a newer observation", () => {
  const calls: Array<URL> = [];
  return Effect.gen(function* () {
    const calendar = yield* ProfessionalCalendar;
    const store = yield* ScheduleObservationRepository;
    const later = DateTime.makeUnsafe("2026-11-01T13:00:00.000Z");
    yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));

    yield* calendar.readLeagueWeek({
      league: "nhl",
      weekStart: "2026-11-01",
      freshness: "calendar",
    });
    yield* TestClock.setTime(DateTime.toEpochMillis(later));
    yield* calendar.readLeagueWeek({
      league: "nhl",
      weekStart: "2026-11-01",
      freshness: "calendar",
      notBefore: later,
    });

    assert.strictEqual(calls.length, 2);
    const stored = yield* store.readProfessionalGames({ from: "2026-11-01", to: "2026-11-07" });
    assert.strictEqual(stored.length, 50);
    assert.isTrue(
      stored.every((row) => DateTime.formatIso(row.observedAt) === "2026-11-01T13:00:00.000Z"),
    );

    const base = stored[0];
    if (base === undefined) {
      throw new Error("The stored week has no games");
    }
    const newer = {
      ...base,
      observedAt: DateTime.makeUnsafe("2026-11-01T14:00:00.000Z"),
      value: { ...base.value, venue: "Newer Venue" },
    };
    const older = {
      ...base,
      observedAt: DateTime.makeUnsafe("2026-11-01T13:30:00.000Z"),
      value: { ...base.value, venue: "Older Venue" },
    };
    yield* store.recordProfessionalGames({
      source: "nhl-web",
      confidence: "authoritative",
      observations: [newer],
    });
    yield* store.recordProfessionalGames({
      source: "nhl-web",
      confidence: "authoritative",
      observations: [older],
    });

    const after = yield* store.readProfessionalGames({ from: "2026-11-01", to: "2026-11-07" });
    const row = after.find((candidate) => candidate.subjectKey === base.subjectKey);
    assert.strictEqual(
      row === undefined ? undefined : DateTime.formatIso(row.observedAt),
      "2026-11-01T14:00:00.000Z",
    );
    assert.strictEqual(row?.value.venue, "Newer Venue");
  }).pipe(Effect.provide(calendarLayer(() => jsonResponse(leagueWeek), calls)));
});

it.effect(
  "stores a club the map does not hold and reports it unresolved instead of dropping it",
  () => {
    const calls: Array<URL> = [];
    return Effect.gen(function* () {
      const calendar = yield* ProfessionalCalendar;
      const store = yield* ScheduleObservationRepository;
      yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));
      const week = yield* calendar.readLeagueWeek({
        league: "nhl",
        weekStart: "2026-11-01",
        freshness: "calendar",
      });

      assert.strictEqual(week.games.length, 1);
      const game = Array.getUnsafe(week.games, 0);
      assert.isNull(game.game.home.providerTeamKey);
      assert.strictEqual(game.game.away.providerTeamKey, winnipegKey);
      assert.deepStrictEqual(week.unresolvedTeams, [
        {
          game: game.sourceReference,
          side: "home",
          identifier: "999",
          name: "Carolina Hurricanes",
          reason: "no_map_entry",
        },
      ]);

      const stored = yield* store.readProfessionalGames({ from: "2026-11-01", to: "2026-11-07" });
      assert.strictEqual(stored.length, 1);
      assert.isNull(Array.getUnsafe(stored, 0).value.home.providerTeamKey);
    }).pipe(
      Effect.provide(
        calendarLayer(
          () =>
            jsonResponse(
              weekPayload([
                {
                  home: { id: 999, abbrev: "CAR", name: "Carolina Hurricanes" },
                  away: { id: 52, abbrev: "WPG", name: "Winnipeg Jets" },
                },
              ]),
            ),
          calls,
        ),
      ),
    );
  },
);

it.effect("stores a postponed game with its status and serves it with it", () => {
  const calls: Array<URL> = [];
  return Effect.gen(function* () {
    const calendar = yield* ProfessionalCalendar;
    const store = yield* ScheduleObservationRepository;
    yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));

    const week = yield* calendar.readLeagueWeek({
      league: "nhl",
      weekStart: "2026-11-01",
      freshness: "calendar",
    });

    assert.deepStrictEqual(
      week.games.map((fact) => [fact.sourceReference, fact.game.status]),
      [
        ["2026020301", "postponed"],
        ["2026020302", "cancelled"],
        ["2026020303", "scheduled"],
        ["2026020304", "final"],
      ],
    );
    const stored = yield* store.readProfessionalGames({ from: "2026-11-01", to: "2026-11-07" });
    assert.deepStrictEqual(
      stored.map((row) => [row.sourceReference, row.value.status, row.value.date]),
      [
        ["2026020302", "cancelled", "2026-11-01"],
        ["2026020303", "scheduled", "2026-11-01"],
        ["2026020301", "postponed", "2026-11-01"],
        ["2026020304", "final", "2026-11-02"],
      ].toSorted((left, right) => String(left[0]).localeCompare(String(right[0]))),
    );
    const postponed = stored.find((row) => row.sourceReference === "2026020301");
    assert.strictEqual(
      postponed === undefined ? undefined : postponed.value.startTime?.timeZone,
      "America/Toronto",
    );
  }).pipe(Effect.provide(calendarLayer(() => jsonResponse(relocatedWeek), calls)));
});

it.effect(
  "serves a second read inside the refresh window without a request and re-reads a stale one",
  () => {
    const calls: Array<URL> = [];
    return Effect.gen(function* () {
      const calendar = yield* ProfessionalCalendar;
      yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));

      yield* calendar.readLeagueWeek({
        league: "nhl",
        weekStart: "2026-11-01",
        freshness: "calendar",
      });
      assert.strictEqual(calls.length, 1);

      yield* TestClock.adjust(3_600_000);
      const insideTheWindow = yield* calendar.readLeagueWeek({
        league: "nhl",
        weekStart: "2026-11-01",
        freshness: "calendar",
      });
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(
        DateTime.formatIso(insideTheWindow.observedAt),
        "2026-11-01T12:00:00.000Z",
      );

      yield* TestClock.setTime(
        DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-01T19:00:00.000Z")),
      );
      const pastTheWindow = yield* calendar.readLeagueWeek({
        league: "nhl",
        weekStart: "2026-11-01",
        freshness: "calendar",
      });
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(DateTime.formatIso(pastTheWindow.observedAt), "2026-11-01T19:00:00.000Z");

      yield* TestClock.adjust(31 * 60_000);
      yield* calendar.readLeagueWeek({
        league: "nhl",
        weekStart: "2026-11-01",
        freshness: "calendar",
      });
      assert.strictEqual(calls.length, 2);

      yield* calendar.readLeagueWeek({
        league: "nhl",
        weekStart: "2026-11-01",
        freshness: "status",
      });
      assert.strictEqual(calls.length, 3);
    }).pipe(Effect.provide(calendarLayer(() => jsonResponse(leagueWeek), calls)));
  },
);

it.effect("reads a shifted week instead of serving another week's slate", () => {
  const calls: Array<URL> = [];
  return Effect.gen(function* () {
    const calendar = yield* ProfessionalCalendar;
    const store = yield* ScheduleObservationRepository;
    yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));

    const first = yield* calendar.readLeagueWeek({
      league: "nhl",
      weekStart: "2026-11-01",
      freshness: "calendar",
    });
    assert.strictEqual(first.games.length, 50);
    assert.strictEqual(calls.length, 1);

    const shifted = yield* calendar.readLeagueWeek({
      league: "nhl",
      weekStart: "2026-11-02",
      freshness: "calendar",
    });
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(shifted.weekStart, "2026-11-02");
    assert.strictEqual(shifted.weekEnd, "2026-11-08");
    assert.strictEqual(shifted.games.length, 50);
    assert.strictEqual(new Set(shifted.games.map((fact) => fact.game.date)).size, 7);

    yield* calendar.readLeagueWeek({
      league: "nhl",
      weekStart: "2026-11-02",
      freshness: "calendar",
    });
    assert.strictEqual(calls.length, 2);

    const stored = yield* store.readProfessionalGames({ from: "2026-11-02", to: "2026-11-08" });
    assert.isTrue(
      stored.some((row) => row.window.from === "2026-11-02" && row.window.to === "2026-11-08"),
    );
    assert.isTrue(
      stored.some((row) => row.window.from === "2026-11-01" && row.window.to === "2026-11-07"),
    );
  }).pipe(
    Effect.provide(
      calendarLayer((weekStart) => jsonResponse(shiftWeek(leagueWeek, weekStart)), calls),
    ),
  );
});

it.effect("keeps the previous observation and refuses when a stale week cannot be re-read", () => {
  const calls: Array<URL> = [];
  let failing = false;
  return Effect.gen(function* () {
    const calendar = yield* ProfessionalCalendar;
    yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));
    yield* calendar.readLeagueWeek({
      league: "nhl",
      weekStart: "2026-11-01",
      freshness: "calendar",
    });

    failing = true;
    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-01T19:00:00.000Z")),
    );
    const refused = yield* Effect.flip(
      calendar.readLeagueWeek({
        league: "nhl",
        weekStart: "2026-11-01",
        freshness: "calendar",
      }),
    );
    assert.instanceOf(refused, ProfessionalGameFactStale);
    assert.strictEqual(
      refused.previousObservedAt === undefined
        ? undefined
        : DateTime.formatIso(refused.previousObservedAt),
      "2026-11-01T12:00:00.000Z",
    );
    assert.strictEqual(refused.cause._tag, "game_source.request_failed");
    assert.strictEqual(calls.length, 2);

    failing = false;
    const recovered = yield* calendar.readLeagueWeek({
      league: "nhl",
      weekStart: "2026-11-01",
      freshness: "calendar",
    });
    assert.strictEqual(calls.length, 3);
    assert.strictEqual(recovered.games.length, 50);
    assert.strictEqual(DateTime.formatIso(recovered.observedAt), "2026-11-01T19:00:00.000Z");
  }).pipe(
    Effect.provide(
      calendarLayer(
        () => (failing ? new Response("down", { status: 503 }) : jsonResponse(leagueWeek)),
        calls,
      ),
    ),
  );
});

it.effect("keeps a club unresolved when the league names it differently from the map", () => {
  const calls: Array<URL> = [];
  return Effect.gen(function* () {
    const calendar = yield* ProfessionalCalendar;
    yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));

    const week = yield* calendar.readLeagueWeek({
      league: "nhl",
      weekStart: "2026-11-01",
      freshness: "calendar",
    });

    const game = Array.getUnsafe(week.games, 0);
    assert.isNull(game.game.home.providerTeamKey);
    assert.strictEqual(game.game.away.providerTeamKey, winnipegKey);
    assert.deepStrictEqual(week.unresolvedTeams, [
      {
        game: game.sourceReference,
        side: "home",
        identifier: "12",
        name: "Carolina Whalers",
        reason: "map_disagrees",
      },
    ]);
  }).pipe(
    Effect.provide(
      calendarLayer(
        () =>
          jsonResponse(
            weekPayload([
              {
                home: { id: 12, abbrev: "CAR", name: "Carolina Whalers" },
                away: { id: 52, abbrev: "WPG", name: "Winnipeg Jets" },
              },
            ]),
          ),
        calls,
      ),
    ),
  );
});

it.effect("measures the requests a day of calendar reads costs for the hockey league", () => {
  const calls: Array<URL> = [];
  return Effect.gen(function* () {
    const calendar = yield* ProfessionalCalendar;
    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-01T00:00:00.000Z")),
    );

    for (let hour = 0; hour < 24 * 7; hour += 1) {
      yield* TestClock.adjust(3_600_000);
      yield* calendar.readLeagueWeek({
        league: "nhl",
        weekStart: "2026-11-01",
        freshness: "calendar",
      });
    }

    assert.strictEqual(calls.length, 28);
  }).pipe(Effect.provide(calendarLayer(() => jsonResponse(leagueWeek), calls)));
});

it.effect("reads the same week once a day for a weekly sweep", () => {
  const calls: Array<URL> = [];
  return Effect.gen(function* () {
    const calendar = yield* ProfessionalCalendar;
    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-01T00:00:00.000Z")),
    );

    for (let day = 0; day < 7; day += 1) {
      yield* calendar.readLeagueWeek({
        league: "nhl",
        weekStart: "2026-11-01",
        freshness: "calendar",
      });
      yield* TestClock.adjust(24 * 3_600_000);
    }

    assert.strictEqual(calls.length, 7);
  }).pipe(Effect.provide(calendarLayer(() => jsonResponse(leagueWeek), calls)));
});

it.effect("refuses a league no game source covers", () => {
  const calls: Array<URL> = [];
  return Effect.gen(function* () {
    const calendar = yield* ProfessionalCalendar;

    const football = yield* Effect.flip(
      calendar.readLeagueWeek({
        league: "nfl",
        weekStart: "2026-11-01",
        freshness: "calendar",
      }),
    );
    assert.instanceOf(football, ProfessionalCalendarUnavailable);
    assert.strictEqual(football.reason, "no_source");

    const malformed = yield* Effect.flip(
      calendar.readLeagueWeek({
        league: "nhl",
        weekStart: "2026-11-31",
        freshness: "calendar",
      }),
    );
    assert.instanceOf(malformed, ProfessionalCalendarUnavailable);
    assert.strictEqual(malformed.reason, "invalid_week");
    assert.strictEqual(calls.length, 0);
  }).pipe(Effect.provide(calendarLayer(() => jsonResponse(leagueWeek), calls)));
});

const WeekPayload = Schema.Struct({
  gameWeek: Schema.Array(
    Schema.Struct({ date: Schema.NonEmptyString, games: Schema.Array(Schema.Unknown) }),
  ),
});

function shiftWeek(payload: unknown, weekStart: string): unknown {
  const decoded = Schema.decodeUnknownSync(WeekPayload)(payload);
  return {
    gameWeek: decoded.gameWeek.map((day, index) => ({
      ...day,
      date: addDays(weekStart, index),
    })),
  };
}

function addDays(date: string, days: number): string {
  return DateTime.formatIsoDate(
    DateTime.add(DateTime.makeUnsafe(`${date}T00:00:00.000Z`), { days }),
  );
}

function calendarLayer(
  respond: (weekStart: string) => Response,
  calls: Array<URL>,
): Layer.Layer<ProfessionalCalendar | ScheduleObservationRepository> {
  const internet = Layer.succeed(PublicInternet)({
    request: (request) =>
      Effect.sync(() => {
        const url = new URL(request.url);
        calls.push(url);
        return respond(url.pathname.slice(url.pathname.lastIndexOf("/") + 1));
      }),
  });
  const sources = Layer.effect(GameSourceRegistry)(
    Effect.map(nhlGameSource, (source) => GameSourceRegistry.of(gameSourceRegistryOf([source]))),
  ).pipe(Layer.provide(internet));
  return ProfessionalCalendarLive.pipe(
    Layer.provideMerge(ScheduleObservationRepositoryTest),
    Layer.provide(sources),
    Layer.orDie,
  );
}

function weekPayload(
  games: ReadonlyArray<{
    readonly home: ClubPayload;
    readonly away: ClubPayload;
  }>,
): unknown {
  return {
    gameWeek: Array.makeBy(7, (index) => ({
      date: DateTime.formatIsoDate(
        DateTime.add(DateTime.makeUnsafe("2026-11-01T00:00:00.000Z"), { days: index }),
      ),
      games:
        index === 0
          ? games.map((entry, gameIndex) => ({
              id: 2026020300 + gameIndex,
              startTimeUTC: "2026-11-01T23:00:00Z",
              venueTimezone: "US/Eastern",
              gameState: "FUT",
              gameScheduleState: "OK",
              homeTeam: teamPayload(entry.home),
              awayTeam: teamPayload(entry.away),
            }))
          : [],
    })),
  };
}

function teamPayload(club: ClubPayload): unknown {
  return {
    id: club.id,
    abbrev: club.abbrev,
    placeName: { default: club.name.slice(0, club.name.lastIndexOf(" ")) },
    commonName: { default: club.name.slice(club.name.lastIndexOf(" ") + 1) },
  };
}

type ClubPayload = {
  readonly id: number;
  readonly abbrev: string;
  readonly name: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function factOf(games: ReadonlyArray<ProfessionalGameFact>, id: string): ProfessionalGameFact {
  const found = games.find((fact) => fact.sourceReference === id);
  if (found === undefined) {
    throw new Error(`The served week has no game ${id}`);
  }
  return found;
}

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./game-sources/nhl/fixtures/${name}`, import.meta.url), "utf8"),
  );
}
