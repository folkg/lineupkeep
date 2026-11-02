import { assert, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";

import { decodeConnectionId } from "./Connection.ts";
import { decodeTeamId } from "./FantasyTeam.ts";
import type { FantasyTeam } from "./FantasyTeam.ts";
import { GameSourceRegistry, gameSourceRegistryOf } from "./GameSource.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import {
  FakeGameSourceWorld,
  fakeGame,
  fakeGameSourceLayer,
} from "./internal/FakeGameSourceTest.ts";
import { ProfessionalCalendarLive } from "./internal/ProfessionalCalendarLive.ts";
import { FakeProviderWorld, ProviderFakeTest } from "./internal/ProviderFakeTest.ts";
import { decideScheduleGate, nextLineupTick } from "./internal/ScheduleGateDecision.ts";
import { ScheduleGateLive } from "./internal/ScheduleGateLive.ts";
import { ScheduleObservationRepository } from "./internal/ScheduleObservationRepository.ts";
import type { ProfessionalGame } from "./ProfessionalGame.ts";
import type { Provider, ProviderRosterSchedule, ProviderUnregistered } from "./Provider.ts";
import { decodeProviderKey } from "./ProviderKey.ts";
import { ProviderRegistry } from "./ProviderRegistry.ts";
import { ScheduleGate } from "./ScheduleGate.ts";

const teamId = decodeTeamId("00000000-0000-7000-8000-000000000001");

const ScheduleObservationRepositoryTest = ScheduleObservationRepository.layer.pipe(
  Layer.provide(ConnectionsDatabaseTest),
);
const GameSourceTest = fakeGameSourceLayer(6);
const CalendarTest = ProfessionalCalendarLive.pipe(
  Layer.provideMerge(ScheduleObservationRepositoryTest),
  Layer.provideMerge(GameSourceTest),
);
const GateTest = ScheduleGateLive.pipe(
  Layer.provideMerge(ScheduleObservationRepositoryTest),
  Layer.provideMerge(CalendarTest),
  Layer.provideMerge(ProviderFakeTest),
);
const EmptySourceTest = Layer.succeed(GameSourceRegistry)(gameSourceRegistryOf([]));
const NoSourceCalendarTest = ProfessionalCalendarLive.pipe(
  Layer.provideMerge(ScheduleObservationRepositoryTest),
  Layer.provideMerge(EmptySourceTest),
);
const NoSourceGateTest = ScheduleGateLive.pipe(
  Layer.provideMerge(ScheduleObservationRepositoryTest),
  Layer.provideMerge(NoSourceCalendarTest),
  Layer.provideMerge(ProviderFakeTest),
);

it.effect("skips a quiet tick, runs a busy one, and fails open on unknown data", () =>
  Effect.gen(function* () {
    const gate = yield* ScheduleGate;
    const fake = yield* FakeProviderWorld;
    const games = yield* FakeGameSourceWorld;
    const provider = yield* providerOf(decodeProviderKey("yahoo"));
    const now = DateTime.makeUnsafe("2026-11-02T12:00:00.000Z");
    const nextTickAt = nextLineupTick(now);

    const quiet = decideScheduleGate({
      now,
      dayStartedAt: DateTime.makeUnsafe("2026-11-02T08:00:00.000Z"),
      dayEndsAt: DateTime.makeUnsafe("2026-11-03T08:00:00.000Z"),
      today: "2026-11-02",
      nextTickAt,
      nextTickDate: "2026-11-02",
      games: [professionalGame("2026-11-03T23:00:00.000Z")],
      providerGameKeys: new Set(),
      teamKeys: new Set(["465.t.1"]),
    });
    assert.strictEqual(quiet.kind, "skip");
    if (quiet.kind === "skip") {
      assert.include(quiet.summary, "Tuesday 2026-11-03");
    }

    const busy = decideScheduleGate({
      now: DateTime.makeUnsafe("2026-11-03T22:30:00.000Z"),
      dayStartedAt: DateTime.makeUnsafe("2026-11-03T08:00:00.000Z"),
      dayEndsAt: DateTime.makeUnsafe("2026-11-04T08:00:00.000Z"),
      today: "2026-11-03",
      nextTickAt: nextLineupTick(DateTime.makeUnsafe("2026-11-03T22:30:00.000Z")),
      nextTickDate: "2026-11-03",
      games: [professionalGame("2026-11-03T23:00:00.000Z")],
      providerGameKeys: new Set(["465.t.1"]),
      teamKeys: new Set(["465.t.1"]),
    });
    assert.deepStrictEqual(busy, { kind: "run", reason: "game_before_next_tick" });

    const missing = decideScheduleGate({
      now,
      dayStartedAt: DateTime.makeUnsafe("2026-11-02T08:00:00.000Z"),
      dayEndsAt: DateTime.makeUnsafe("2026-11-03T08:00:00.000Z"),
      today: "2026-11-02",
      nextTickAt,
      nextTickDate: "2026-11-02",
      games: [],
      providerGameKeys: new Set(["465.t.1"]),
      teamKeys: new Set(["465.t.1"]),
    });
    assert.deepStrictEqual(missing, { kind: "run", reason: "provider_game_missing_from_source" });

    const unknownStart = decideScheduleGate({
      now,
      dayStartedAt: DateTime.makeUnsafe("2026-11-02T08:00:00.000Z"),
      dayEndsAt: DateTime.makeUnsafe("2026-11-03T08:00:00.000Z"),
      today: "2026-11-02",
      nextTickAt,
      nextTickDate: "2026-11-02",
      games: [professionalGame(null)],
      providerGameKeys: new Set(),
      teamKeys: new Set(["465.t.1"]),
    });
    assert.deepStrictEqual(unknownStart, { kind: "run", reason: "game_start_unknown" });

    yield* TestClock.setTime(DateTime.toEpochMillis(now));
    yield* fake.setSchedule(providerSchedule());
    yield* games.setGames([fakeGame(professionalGameInput("2026-11-03T23:00:00.000Z"))]);
    const quietEvaluation = yield* gate.evaluate({
      team: teamFixture(),
      provider,
      session: Redacted.make("A1=fake-session"),
      now,
    });
    assert.strictEqual(quietEvaluation.kind, "skip");

    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-03T22:30:00Z")));
    const busyEvaluation = yield* gate.evaluate({
      team: teamFixture(),
      provider,
      session: Redacted.make("A1=fake-session"),
      now: DateTime.makeUnsafe("2026-11-03T22:30:00Z"),
    });
    assert.deepStrictEqual(busyEvaluation, { kind: "run", reason: "game_before_next_tick" });

    yield* games.setFailure("unavailable");
    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-04T09:00:00Z")));
    const failed = yield* gate.evaluate({
      team: teamFixture(),
      provider,
      session: Redacted.make("A1=fake-session"),
      now: DateTime.makeUnsafe("2026-11-04T09:00:00Z"),
    });
    assert.deepStrictEqual(failed, { kind: "run", reason: "game_source_unavailable" });
  }).pipe(Effect.provide(GateTest)),
);

it.effect("fails open when the provider schedule or a roster team is unknown", () =>
  Effect.gen(function* () {
    const gate = yield* ScheduleGate;
    const fake = yield* FakeProviderWorld;
    const provider = yield* providerOf(decodeProviderKey("yahoo"));
    const now = DateTime.makeUnsafe("2026-11-02T12:00:00.000Z");
    yield* TestClock.setTime(DateTime.toEpochMillis(now));

    yield* fake.setSchedule(undefined);
    const noProviderSchedule = yield* gate.evaluate({
      team: teamFixture(),
      provider,
      session: Redacted.make("A1=fake-session"),
      now,
    });
    assert.deepStrictEqual(noProviderSchedule, {
      kind: "run",
      reason: "provider_schedule_unavailable",
    });

    yield* fake.setSchedule({
      ...providerSchedule(),
      players: [
        {
          providerPlayerKey: "465.p.1",
          name: "Synthetic Skater",
          proTeamKey: undefined,
          proTeamAbbreviation: undefined,
          games: [],
        },
      ],
    });
    const unmapped = yield* gate.evaluate({
      team: teamFixture(),
      provider,
      session: Redacted.make("A1=fake-session"),
      now,
    });
    assert.deepStrictEqual(unmapped, { kind: "run", reason: "roster_team_unmapped" });
  }).pipe(Effect.provide(GateTest)),
);

it.effect("fails open for a sport with no game source", () =>
  Effect.gen(function* () {
    const gate = yield* ScheduleGate;
    const fake = yield* FakeProviderWorld;
    const provider = yield* providerOf(decodeProviderKey("yahoo"));
    const now = DateTime.makeUnsafe("2026-11-02T12:00:00.000Z");
    yield* TestClock.setTime(DateTime.toEpochMillis(now));
    yield* fake.setSchedule({
      providerTeamKey: "461.l.1000.t.1",
      period: { type: "date", start: "2026-11-02", end: "2026-11-02" },
      dates: ["2026-11-02"],
      players: [
        {
          providerPlayerKey: "461.p.1",
          name: "Weekly Starter",
          proTeamKey: "461.t.1",
          proTeamAbbreviation: "SYN",
          games: [{ date: "2026-11-02", opponent: "BOS", home: true }],
        },
      ],
    });

    const decision = yield* gate.evaluate({
      team: {
        ...teamFixture(),
        league: "nfl",
        sport: "football",
        providerTeamKey: "461.l.1000.t.1",
      },
      provider,
      session: Redacted.make("A1=fake-session"),
      now,
    });
    assert.deepStrictEqual(decision, { kind: "run", reason: "no_game_source" });
  }).pipe(Effect.provide(NoSourceGateTest)),
);

it.effect("measures one provider read across a quiet day of hourly ticks", () =>
  Effect.gen(function* () {
    const gate = yield* ScheduleGate;
    const fake = yield* FakeProviderWorld;
    const games = yield* FakeGameSourceWorld;
    const provider = yield* providerOf(decodeProviderKey("yahoo"));
    yield* fake.setSchedule(providerSchedule());
    yield* games.setGames([fakeGame(professionalGameInput("2026-11-03T23:00:00.000Z"))]);

    const start = DateTime.makeUnsafe("2026-11-02T08:05:00.000Z");
    yield* TestClock.setTime(DateTime.toEpochMillis(start));
    for (let tick = 0; tick < 24; tick += 1) {
      const now = DateTime.add(start, { hours: tick });
      const decision = yield* gate.evaluate({
        team: teamFixture(),
        provider,
        session: Redacted.make("A1=fake-session"),
        now,
      });
      assert.strictEqual(decision.kind, "skip");
    }

    assert.strictEqual(yield* fake.providerCalls, 1);
    assert.strictEqual(yield* fake.providerReads, 1);
  }).pipe(Effect.provide(GateTest)),
);

function providerOf(
  provider: ReturnType<typeof decodeProviderKey>,
): Effect.Effect<Provider, ProviderUnregistered, ProviderRegistry> {
  return Effect.gen(function* () {
    const registry = yield* ProviderRegistry;
    return yield* registry.requireProvider(provider);
  });
}

function teamFixture(): FantasyTeam {
  return {
    id: teamId,
    connectionId: decodeConnectionId("00000000-0000-7000-8000-000000000002"),
    provider: decodeProviderKey("yahoo"),
    providerTeamKey: "465.l.2000.t.1",
    providerLeagueKey: "465.l.2000",
    league: "nhl",
    sport: "hockey",
    season: 2026,
    name: "Gamma",
    availability: "available",
    automation: {
      status: "enabled",
      changedAt: DateTime.makeUnsafe("2026-10-01T00:00:00.000Z"),
    },
    ownerNote: null,
    ownerNoteUpdatedAt: null,
    lastSeenAt: DateTime.makeUnsafe("2026-10-01T00:00:00.000Z"),
    createdAt: DateTime.makeUnsafe("2026-10-01T00:00:00.000Z"),
    updatedAt: DateTime.makeUnsafe("2026-10-01T00:00:00.000Z"),
  };
}

function providerSchedule(): ProviderRosterSchedule {
  return {
    providerTeamKey: "465.l.2000.t.1",
    period: { type: "date", start: "2026-11-01", end: "2026-11-08" },
    dates: [
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
    ],
    players: [
      {
        providerPlayerKey: "465.p.1",
        name: "Synthetic Skater",
        proTeamKey: "465.t.1",
        proTeamAbbreviation: "TOR",
        games: [{ date: "2026-11-03", opponent: "BOS", home: true }],
      },
    ],
  };
}

function professionalGameInput(startTime: string): Parameters<typeof fakeGame>[0] {
  return {
    id: "g1",
    date: "2026-11-03",
    startTime,
    home: { identifier: "nhl.t.TOR", abbreviation: "TOR", name: "Toronto" },
    away: { identifier: "nhl.t.BOS", abbreviation: "BOS", name: "Boston" },
  };
}

function professionalGame(startTime: string | null): ProfessionalGame {
  return {
    league: "nhl",
    date: "2026-11-02",
    startTime:
      startTime === null ? null : { instant: DateTime.makeUnsafe(startTime), timeZone: "UTC" },
    home: {
      providerTeamKey: "465.t.1",
      sourceTeamIdentifier: "nhl.t.TOR",
      sourceTeamAbbreviation: "TOR",
      sourceTeamName: "Toronto",
    },
    away: {
      providerTeamKey: "465.t.2",
      sourceTeamIdentifier: "nhl.t.BOS",
      sourceTeamAbbreviation: "BOS",
      sourceTeamName: "Boston",
    },
    venue: null,
    status: "scheduled",
  };
}
