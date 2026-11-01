import { readFileSync } from "node:fs";

import { assert, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";

import { GameSourceRegistry, gameSourceRegistryOf } from "#contexts/connections/GameSource.ts";
import {
  ProfessionalCalendar,
  ProfessionalCalendarUnavailable,
  ProfessionalGameFactStale,
} from "#contexts/connections/ProfessionalCalendar.ts";
import type { ProfessionalGameFact } from "#contexts/connections/ProfessionalCalendar.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";
import type { QueryPersistenceFailed } from "#contexts/connections/QueryValues.ts";
import { PublicInternet } from "#runtime/PublicInternet.ts";

import { ConnectionsDatabaseTest } from "./ConnectionsDatabaseTest.ts";
import { nhlGameSource } from "./game-sources/nhl/NhlGameSource.ts";
import { ObservedFactRepository } from "./ObservedFactRepository.ts";
import { ProfessionalCalendarLive } from "./ProfessionalCalendarLive.ts";

const ProviderTeamPairsFixture = Schema.decodeUnknownSync(
  Schema.Struct({
    pairs: Schema.Array(
      Schema.Struct({
        providerTeamKey: Schema.NonEmptyString,
        abbreviation: Schema.NonEmptyString,
      }),
    ),
  }),
)(fixture("provider-team-pairs.json"));
const leagueWeek = fixture("league-week.json");
const relocatedWeek = fixture("relocated-week.json");
const providerPairs = ProviderTeamPairsFixture.pairs;
const pairByAbbreviation = new Map(
  providerPairs.map((pair) => [pair.abbreviation, pair.providerTeamKey]),
);
const openerId = "2026020227";
const observedAt = DateTime.makeUnsafe("2026-11-01T12:00:00.000Z");

const ObservedFactRepositoryTest = ObservedFactRepository.layer.pipe(
  Layer.provide(ConnectionsDatabaseTest),
);

it.effect("produces a fact for every game of one league-week request with teams resolved", () => {
  const calls: Array<URL> = [];
  return Effect.gen(function* () {
    const calendar = yield* ProfessionalCalendar;
    const facts = yield* ObservedFactRepository;
    yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));
    yield* seedProviderPairs(facts);

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
    assert.strictEqual(opener.game.home.providerTeamKey, pairByAbbreviation.get("CAR"));
    assert.strictEqual(opener.game.away.providerTeamKey, pairByAbbreviation.get("WPG"));
    assert.strictEqual(opener.game.home.sourceTeamAbbreviation, "CAR");
    assert.strictEqual(opener.game.startTime?.timeZone, "US/Eastern");
    assert.strictEqual(opener.game.venue, "Lenovo Center");

    const stored = yield* facts.readProfessionalGames({ from: "2026-11-01", to: "2026-11-07" });
    assert.strictEqual(stored.length, 50);
    assert.isTrue(
      stored.every(
        (row) => row.value.home.providerTeamKey !== null && row.value.away.providerTeamKey !== null,
      ),
    );

    const identities = yield* facts.readSourceTeamIdentities({
      sport: "hockey",
      source: "nhl-web",
    });
    assert.strictEqual(identities.length, 32);
    assert.deepStrictEqual(
      new Set(identities.map((identity) => identity.providerTeamKey)).size,
      32,
    );
  }).pipe(Effect.provide(calendarLayer(() => jsonResponse(leagueWeek), calls)));
});

it.effect("stores an unmapped team's game and reports it unresolved instead of dropping it", () => {
  const calls: Array<URL> = [];
  return Effect.gen(function* () {
    const calendar = yield* ProfessionalCalendar;
    const facts = yield* ObservedFactRepository;
    yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));
    yield* seedProviderPairs(
      facts,
      providerPairs.filter((pair) => pair.abbreviation !== "CAR" && pair.abbreviation !== "WPG"),
    );

    const week = yield* calendar.readLeagueWeek({
      league: "nhl",
      weekStart: "2026-11-01",
      freshness: "calendar",
    });

    assert.strictEqual(week.games.length, 50);
    const opener = factOf(week.games, openerId);
    assert.isNull(opener.game.home.providerTeamKey);
    assert.isNull(opener.game.away.providerTeamKey);
    assert.deepStrictEqual(
      week.unresolvedTeams.filter((team) => team.game === openerId),
      [
        {
          game: openerId,
          side: "home",
          identifier: "12",
          name: "Carolina Hurricanes",
        },
        {
          game: openerId,
          side: "away",
          identifier: "52",
          name: "Winnipeg Jets",
        },
      ],
    );

    const stored = yield* facts.readProfessionalGames({ from: "2026-11-01", to: "2026-11-07" });
    assert.strictEqual(stored.length, 50);
    const storedOpener = stored.find((row) => row.sourceReference === openerId);
    assert.isNull(storedOpener === undefined ? undefined : storedOpener.value.home.providerTeamKey);

    const identities = yield* facts.readSourceTeamIdentities({
      sport: "hockey",
      source: "nhl-web",
    });
    assert.strictEqual(identities.length, 30);
    assert.isFalse(identities.some((identity) => identity.sourceTeamIdentifier === "12"));
  }).pipe(Effect.provide(calendarLayer(() => jsonResponse(leagueWeek), calls)));
});

it.effect("stores a postponed game with its status and serves it with it", () => {
  const calls: Array<URL> = [];
  return Effect.gen(function* () {
    const calendar = yield* ProfessionalCalendar;
    const facts = yield* ObservedFactRepository;
    yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));
    yield* seedProviderPairs(facts);

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
    const stored = yield* facts.readProfessionalGames({ from: "2026-11-01", to: "2026-11-07" });
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
    const facts = yield* ObservedFactRepository;
    yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));
    yield* seedProviderPairs(facts);

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

    const stored = yield* facts.readProfessionalGames({ from: "2026-11-02", to: "2026-11-08" });
    assert.isTrue(
      stored.some((row) => row.window.from === "2026-11-02" && row.window.to === "2026-11-08"),
    );
    assert.isTrue(
      stored.some((row) => row.window.from === "2026-11-01" && row.window.to === "2026-11-07"),
    );
    const identities = yield* facts.readSourceTeamIdentities({
      sport: "hockey",
      source: "nhl-web",
    });
    assert.strictEqual(identities.length, 32);
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

it.effect("refuses an abbreviation the provider publishes for two teams", () => {
  const calls: Array<URL> = [];
  return Effect.gen(function* () {
    const calendar = yield* ProfessionalCalendar;
    const facts = yield* ObservedFactRepository;
    yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));
    yield* seedProviderPairs(facts, [
      ...providerPairs.filter((pair) => pair.abbreviation !== "CAR"),
      { providerTeamKey: "fixture.t.100", abbreviation: "CAR" },
      { providerTeamKey: "fixture.t.101", abbreviation: "CAR" },
    ]);

    const week = yield* calendar.readLeagueWeek({
      league: "nhl",
      weekStart: "2026-11-01",
      freshness: "calendar",
    });

    const opener = factOf(week.games, openerId);
    assert.isNull(opener.game.home.providerTeamKey);
    assert.strictEqual(opener.game.away.providerTeamKey, pairByAbbreviation.get("WPG"));
    const identities = yield* facts.readSourceTeamIdentities({
      sport: "hockey",
      source: "nhl-web",
    });
    assert.strictEqual(identities.length, 31);
    assert.isFalse(identities.some((identity) => identity.sourceTeamIdentifier === "12"));
  }).pipe(Effect.provide(calendarLayer(() => jsonResponse(leagueWeek), calls)));
});

it.effect("leaves a team unresolved when the provider abbreviates it differently", () => {
  const calls: Array<URL> = [];
  return Effect.gen(function* () {
    const calendar = yield* ProfessionalCalendar;
    const facts = yield* ObservedFactRepository;
    yield* TestClock.setTime(DateTime.toEpochMillis(observedAt));
    yield* seedProviderPairs(facts, [
      ...providerPairs.filter((pair) => pair.abbreviation !== "LAK"),
      { providerTeamKey: "fixture.t.200", abbreviation: "LA" },
    ]);

    const week = yield* calendar.readLeagueWeek({
      league: "nhl",
      weekStart: "2026-11-01",
      freshness: "calendar",
    });

    const kings = week.games.flatMap((fact) =>
      [fact.game.home, fact.game.away].filter((team) => team.sourceTeamAbbreviation === "LAK"),
    );
    assert.isAbove(kings.length, 0);
    assert.isTrue(kings.every((team) => team.providerTeamKey === null));
    assert.isTrue(
      week.unresolvedTeams.some((team) => team.identifier === "26" && team.name.includes("Kings")),
    );
  }).pipe(Effect.provide(calendarLayer(() => jsonResponse(leagueWeek), calls)));
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
): Layer.Layer<ProfessionalCalendar | ObservedFactRepository> {
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
    Layer.provideMerge(ObservedFactRepositoryTest),
    Layer.provide(sources),
    Layer.orDie,
  );
}

function seedProviderPairs(
  facts: ObservedFactRepository["Service"],
  pairs: ReadonlyArray<{
    readonly providerTeamKey: string;
    readonly abbreviation: string;
  }> = providerPairs,
): Effect.Effect<void, QueryPersistenceFailed> {
  const provider = decodeProviderKey("yahoo");
  return facts.recordTeamIdentities(
    pairs.map((pair) => ({
      sport: "hockey",
      source: provider,
      sourceTeamIdentifier: pair.abbreviation,
      provider,
      providerTeamKey: pair.providerTeamKey,
      observedAt,
    })),
  );
}

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
