import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";

import { decodeUserId } from "#contexts/auth/User.ts";

import { decodeConnectionId } from "./Connection.ts";
import { decodeTeamId } from "./FantasyTeam.ts";
import type { FantasyTeam } from "./FantasyTeam.ts";
import { GameSourceRegistry, gameSourceRegistryOf } from "./GameSource.ts";
import { ConnectionsDatabase } from "./internal/ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import {
  FakeGameSourceWorld,
  fakeGame,
  fakeGameSourceLayer,
} from "./internal/FakeGameSourceTest.ts";
import { LineupRunRepository } from "./internal/LineupRunRepository.ts";
import { lineupRuns } from "./internal/LineupRunTables.ts";
import { LineupRunState, lineupRunStatus } from "./internal/LineupRunWorkflow.ts";
import { ProfessionalCalendarLive } from "./internal/ProfessionalCalendarLive.ts";
import { FakeProviderWorld, ProviderFakeTest } from "./internal/ProviderFakeTest.ts";
import { decideScheduleGate, nextLineupTick } from "./internal/ScheduleGateDecision.ts";
import { ScheduleGateLive } from "./internal/ScheduleGateLive.ts";
import { ScheduleObservationRepository } from "./internal/ScheduleObservationRepository.ts";
import { scheduleObservations } from "./internal/ScheduleObservationTables.ts";
import { LineupRunId } from "./LineupRun.ts";
import type { ProfessionalGame } from "./ProfessionalGame.ts";
import type { Provider, ProviderRosterSchedule, ProviderUnregistered } from "./Provider.ts";
import { decodeProviderKey } from "./ProviderKey.ts";
import { ProviderRegistry } from "./ProviderRegistry.ts";
import { ScheduleGate } from "./ScheduleGate.ts";
import type { ScheduleGateDecision } from "./ScheduleGate.ts";

const teamId = decodeTeamId("00000000-0000-7000-8000-000000000001");
const owner = decodeUserId("owner-schedule-gate");
const currentRun = Schema.decodeSync(LineupRunId)("018f79ea-7d86-7c18-9b4a-0000000000ff");

const ScheduleObservationRepositoryTest = ScheduleObservationRepository.layer.pipe(
  Layer.provide(ConnectionsDatabaseTest),
);
const LineupRepositoryTest = LineupRunRepository.layer.pipe(Layer.provide(ConnectionsDatabaseTest));
const GameSourceTest = fakeGameSourceLayer(6);
const CalendarTest = ProfessionalCalendarLive.pipe(
  Layer.provideMerge(ScheduleObservationRepositoryTest),
  Layer.provideMerge(GameSourceTest),
);
const GateTest = ScheduleGateLive.pipe(
  Layer.provideMerge(ScheduleObservationRepositoryTest),
  Layer.provideMerge(CalendarTest),
  Layer.provideMerge(ProviderFakeTest),
  Layer.provideMerge(LineupRepositoryTest),
  Layer.provideMerge(ConnectionsDatabaseTest),
  Layer.provide(NodeCrypto.layer),
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
  Layer.provideMerge(LineupRepositoryTest),
  Layer.provide(NodeCrypto.layer),
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
      todayRun: { kind: "verified" },
    });
    assert.strictEqual(quiet.kind, "skip");
    if (quiet.kind === "skip") {
      assert.strictEqual(quiet.summary, "No games before the next scheduled check.");
      assert.strictEqual(quiet.nextTickAt, nextTickAt);
      assert.strictEqual(
        quiet.nextGameAt === undefined ? undefined : DateTime.formatIso(quiet.nextGameAt),
        "2026-11-03T23:00:00.000Z",
      );
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
      todayRun: { kind: "none" },
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
      todayRun: { kind: "none" },
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
      todayRun: { kind: "none" },
    });
    assert.deepStrictEqual(unknownStart, { kind: "run", reason: "game_start_unknown" });

    yield* TestClock.setTime(DateTime.toEpochMillis(now));
    yield* fake.setSchedule(providerSchedule());
    yield* games.setGames([fakeGame(professionalGameInput("2026-11-03T23:00:00.000Z"))]);
    yield* seedRun({
      id: runId(1),
      outcome: "verified",
      at: DateTime.makeUnsafe("2026-11-02T08:05:00.000Z"),
    });
    const quietEvaluation = yield* gate.evaluate({
      team: teamFixture(),
      provider,
      session: Redacted.make("A1=fake-session"),
      now,
      userId: owner,
      excludingRun: currentRun,
    });
    assert.strictEqual(quietEvaluation.kind, "skip");

    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-03T22:30:00Z")));
    const busyEvaluation = yield* gate.evaluate({
      team: teamFixture(),
      provider,
      session: Redacted.make("A1=fake-session"),
      now: DateTime.makeUnsafe("2026-11-03T22:30:00Z"),
      userId: owner,
      excludingRun: currentRun,
    });
    assert.deepStrictEqual(busyEvaluation, { kind: "run", reason: "game_before_next_tick" });

    yield* games.setFailure("unavailable");
    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-04T09:00:00Z")));
    const failed = yield* gate.evaluate({
      team: teamFixture(),
      provider,
      session: Redacted.make("A1=fake-session"),
      now: DateTime.makeUnsafe("2026-11-04T09:00:00Z"),
      userId: owner,
      excludingRun: currentRun,
    });
    assert.deepStrictEqual(failed, { kind: "run", reason: "game_source_unavailable" });
  }).pipe(Effect.provide(GateTest)),
);

it("skips a quiet tick with a plain reason when no game is scheduled", () => {
  const now = DateTime.makeUnsafe("2026-11-02T12:00:00.000Z");
  const nextTickAt = nextLineupTick(now);

  const decision = decideScheduleGate({
    now,
    dayStartedAt: DateTime.makeUnsafe("2026-11-02T08:00:00.000Z"),
    dayEndsAt: DateTime.makeUnsafe("2026-11-03T08:00:00.000Z"),
    today: "2026-11-02",
    nextTickAt,
    nextTickDate: "2026-11-02",
    games: [],
    providerGameKeys: new Set(),
    teamKeys: new Set(["465.t.1"]),
    todayRun: { kind: "verified" },
  });

  assert.strictEqual(decision.kind, "skip");
  if (decision.kind === "skip") {
    assert.strictEqual(decision.summary, "No rostered player has a game scheduled.");
    assert.strictEqual(decision.nextTickAt, nextTickAt);
    assert.strictEqual(decision.nextGameAt, undefined);
  }
});

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
      userId: owner,
      excludingRun: currentRun,
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
      userId: owner,
      excludingRun: currentRun,
    });
    assert.deepStrictEqual(unmapped, { kind: "run", reason: "roster_team_unmapped" });
  }).pipe(Effect.provide(GateTest)),
);

it.effect("places a team from a stored game whose club the map knows", () =>
  Effect.gen(function* () {
    const gate = yield* ScheduleGate;
    const fake = yield* FakeProviderWorld;
    const provider = yield* providerOf(decodeProviderKey("yahoo"));
    const now = DateTime.makeUnsafe("2026-11-02T12:00:00.000Z");
    yield* TestClock.setTime(DateTime.toEpochMillis(now));
    yield* fake.setSchedule({
      ...providerSchedule(),
      players: [
        {
          providerPlayerKey: "465.p.1",
          name: "Synthetic Skater",
          proTeamKey: "nhl.t.21",
          proTeamAbbreviation: "TOR",
          games: [{ date: "2026-11-02", opponent: "BOS", home: true }],
        },
      ],
    });
    yield* seedStoredGame({
      home: {
        identifier: "10",
        abbreviation: "TOR",
        name: "Toronto Maple Leafs",
        providerTeamKey: null,
      },
      away: {
        identifier: "6",
        abbreviation: "BOS",
        name: "Boston Bruins",
        providerTeamKey: "nhl.t.60",
      },
      observedAt: now,
    });
    yield* seedRun({
      id: runId(9),
      outcome: "verified",
      at: DateTime.makeUnsafe("2026-11-02T08:05:00.000Z"),
    });

    const decision = yield* gate.evaluate({
      team: teamFixture(),
      provider,
      session: Redacted.make("A1=fake-session"),
      now,
      userId: owner,
      excludingRun: currentRun,
    });
    assert.isFalse(
      decision.kind === "run" && decision.reason === "provider_game_missing_from_source",
    );
    assert.strictEqual(decision.kind, "skip");
    if (decision.kind === "skip") {
      assert.strictEqual(decision.summary, "No games before the next scheduled check.");
      assert.strictEqual(
        decision.nextGameAt === undefined ? undefined : DateTime.formatIso(decision.nextGameAt),
        "2026-11-02T23:00:00.000Z",
      );
    }
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
      userId: owner,
      excludingRun: currentRun,
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
    yield* seedRun({
      id: runId(2),
      outcome: "verified",
      at: DateTime.makeUnsafe("2026-11-02T08:01:00.000Z"),
    });
    for (let tick = 0; tick < 24; tick += 1) {
      const now = DateTime.add(start, { hours: tick });
      const decision = yield* gate.evaluate({
        team: teamFixture(),
        provider,
        session: Redacted.make("A1=fake-session"),
        now,
        userId: owner,
        excludingRun: currentRun,
      });
      assert.strictEqual(decision.kind, "skip");
    }

    assert.strictEqual(yield* fake.providerCalls, 1);
    assert.strictEqual(yield* fake.providerReads, 1);
  }).pipe(Effect.provide(GateTest)),
);

it.effect("runs a quiet tick when the team has no lineup run today", () =>
  Effect.gen(function* () {
    assert.deepStrictEqual(yield* evaluateQuietTick(), { kind: "run", reason: "no_run_today" });
  }).pipe(Effect.provide(GateTest)),
);

it.effect("runs a quiet tick when today's last run was blocked", () =>
  Effect.gen(function* () {
    yield* seedRun({
      id: runId(3),
      outcome: "blocked",
      at: DateTime.makeUnsafe("2026-11-02T11:05:00.000Z"),
    });

    assert.deepStrictEqual(yield* evaluateQuietTick(), {
      kind: "run",
      reason: "last_run_blocked",
    });
  }).pipe(Effect.provide(GateTest)),
);

it.effect("skips a quiet tick after a verified run today and names the next game", () =>
  Effect.gen(function* () {
    yield* seedRun({
      id: runId(4),
      outcome: "changed",
      at: DateTime.makeUnsafe("2026-11-02T09:05:00.000Z"),
    });

    const decision = yield* evaluateQuietTick();
    assert.strictEqual(decision.kind, "skip");
    if (decision.kind === "skip") {
      assert.strictEqual(decision.summary, "No games before the next scheduled check.");
      assert.strictEqual(
        decision.nextGameAt === undefined ? undefined : DateTime.formatIso(decision.nextGameAt),
        "2026-11-03T23:00:00.000Z",
      );
    }
  }).pipe(Effect.provide(GateTest)),
);

it.effect("runs a quiet tick when today's last run ended unverified", () =>
  Effect.gen(function* () {
    yield* seedRun({
      id: runId(5),
      outcome: "uncertain",
      at: DateTime.makeUnsafe("2026-11-02T11:05:00.000Z"),
    });

    assert.deepStrictEqual(yield* evaluateQuietTick(), {
      kind: "run",
      reason: "last_run_unverified",
    });
  }).pipe(Effect.provide(GateTest)),
);

it.effect("runs a quiet tick when today's last run has no outcome yet", () =>
  Effect.gen(function* () {
    yield* seedRun({
      id: runId(6),
      outcome: "retry-wait",
      at: DateTime.makeUnsafe("2026-11-02T11:05:00.000Z"),
    });

    assert.deepStrictEqual(yield* evaluateQuietTick(), {
      kind: "run",
      reason: "last_run_unverified",
    });
  }).pipe(Effect.provide(GateTest)),
);

it.effect("runs a quiet tick when the verified run is from yesterday", () =>
  Effect.gen(function* () {
    yield* seedRun({
      id: runId(7),
      outcome: "verified",
      at: DateTime.makeUnsafe("2026-11-01T22:00:00.000Z"),
    });

    assert.deepStrictEqual(yield* evaluateQuietTick(), { kind: "run", reason: "no_run_today" });
  }).pipe(Effect.provide(GateTest)),
);

it.effect("ignores the run whose schedule gate is being decided", () =>
  Effect.gen(function* () {
    yield* seedRun({
      id: currentRun,
      outcome: "verified",
      at: DateTime.makeUnsafe("2026-11-02T09:05:00.000Z"),
    });

    assert.deepStrictEqual(yield* evaluateQuietTick(), { kind: "run", reason: "no_run_today" });
  }).pipe(Effect.provide(GateTest)),
);

it.effect("runs a busy tick even after a verified run today", () =>
  Effect.gen(function* () {
    const gate = yield* ScheduleGate;
    const fake = yield* FakeProviderWorld;
    const games = yield* FakeGameSourceWorld;
    const provider = yield* providerOf(decodeProviderKey("yahoo"));
    const now = DateTime.makeUnsafe("2026-11-03T22:30:00.000Z");
    yield* TestClock.setTime(DateTime.toEpochMillis(now));
    yield* fake.setSchedule(providerSchedule());
    yield* games.setGames([fakeGame(professionalGameInput("2026-11-03T23:00:00.000Z"))]);
    yield* seedRun({
      id: runId(8),
      outcome: "verified",
      at: DateTime.makeUnsafe("2026-11-03T09:05:00.000Z"),
    });

    const decision = yield* gate.evaluate({
      team: teamFixture(),
      provider,
      session: Redacted.make("A1=fake-session"),
      now,
      userId: owner,
      excludingRun: currentRun,
    });
    assert.deepStrictEqual(decision, { kind: "run", reason: "game_before_next_tick" });
  }).pipe(Effect.provide(GateTest)),
);

it("runs a quiet tick unless today's run is verified", () => {
  const quiet = {
    now: DateTime.makeUnsafe("2026-11-02T12:00:00.000Z"),
    dayStartedAt: DateTime.makeUnsafe("2026-11-02T08:00:00.000Z"),
    dayEndsAt: DateTime.makeUnsafe("2026-11-03T08:00:00.000Z"),
    today: "2026-11-02",
    nextTickAt: nextLineupTick(DateTime.makeUnsafe("2026-11-02T12:00:00.000Z")),
    nextTickDate: "2026-11-02",
    games: [professionalGame("2026-11-03T23:00:00.000Z")],
    providerGameKeys: new Set<string>(),
    teamKeys: new Set(["465.t.1"]),
  };

  assert.deepStrictEqual(decideScheduleGate({ ...quiet, todayRun: { kind: "none" } }), {
    kind: "run",
    reason: "no_run_today",
  });
  assert.deepStrictEqual(decideScheduleGate({ ...quiet, todayRun: { kind: "blocked" } }), {
    kind: "run",
    reason: "last_run_blocked",
  });
  assert.deepStrictEqual(decideScheduleGate({ ...quiet, todayRun: { kind: "unverified" } }), {
    kind: "run",
    reason: "last_run_unverified",
  });
  assert.strictEqual(decideScheduleGate({ ...quiet, todayRun: { kind: "verified" } }).kind, "skip");
});

const quietNow = DateTime.makeUnsafe("2026-11-02T12:00:00.000Z");

function evaluateQuietTick(): Effect.Effect<
  ScheduleGateDecision,
  ProviderUnregistered,
  ScheduleGate | FakeProviderWorld | FakeGameSourceWorld | ProviderRegistry
> {
  return Effect.gen(function* () {
    const gate = yield* ScheduleGate;
    const fake = yield* FakeProviderWorld;
    const games = yield* FakeGameSourceWorld;
    const provider = yield* providerOf(decodeProviderKey("yahoo"));
    yield* TestClock.setTime(DateTime.toEpochMillis(quietNow));
    yield* fake.setSchedule(providerSchedule());
    yield* games.setGames([fakeGame(professionalGameInput("2026-11-03T23:00:00.000Z"))]);

    return yield* gate.evaluate({
      team: teamFixture(),
      provider,
      session: Redacted.make("A1=fake-session"),
      now: quietNow,
      userId: owner,
      excludingRun: currentRun,
    });
  });
}

function runId(serial: number): LineupRunId {
  return Schema.decodeSync(LineupRunId)(
    `018f79ea-7d86-7c18-9b4a-${String(serial).padStart(12, "0")}`,
  );
}

type SeededOutcome = "verified" | "changed" | "blocked" | "uncertain" | "retry-wait";

function seedRun(input: {
  readonly id: LineupRunId;
  readonly outcome: SeededOutcome;
  readonly at: DateTime.Utc;
}): Effect.Effect<void, never, ConnectionsDatabase> {
  return Effect.gen(function* () {
    const database = yield* ConnectionsDatabase;
    const state = seededState(input.outcome, input.at);
    const encoded = yield* Schema.encodeEffect(Schema.toCodecJson(LineupRunState))(state);
    yield* database.insert(lineupRuns).values({
      id: input.id,
      userId: owner,
      requestId: "018f79ea-7d86-7c18-9b4a-0000000000aa",
      teamId,
      connectionId: "00000000-0000-7000-8000-000000000002",
      trigger: "scheduled",
      scheduleKey: null,
      target: { coverage: "current" },
      status: lineupRunStatus(state),
      state: encoded,
      implementation: "custom_policy",
      implementationVersion: "custom-policy/2",
      attempts: 1,
      nextActionAt: null,
      createdAt: DateTime.toDateUtc(input.at),
      updatedAt: DateTime.toDateUtc(input.at),
    });
  }).pipe(Effect.orDie);
}

function seededState(outcome: SeededOutcome, at: DateTime.Utc): LineupRunState {
  const base = {
    team: teamId,
    target: { coverage: "current" as const },
    trigger: "scheduled" as const,
    implementation: "custom_policy" as const,
    implementationVersion: "custom-policy/2",
    updatedAt: at,
  };
  const recorded = {
    reconciled: false,
    observedAt: at,
    changes: [],
    lockedPlayers: 0,
    editablePlayers: 0,
  };
  switch (outcome) {
    case "verified":
      return {
        ...base,
        _tag: "Completed",
        outcome: {
          ...recorded,
          kind: "no_op",
          verified: true,
          summary: "The lineup already matched the explicit plan; no provider write was needed.",
        },
      };
    case "changed":
      return {
        ...base,
        _tag: "Completed",
        outcome: {
          ...recorded,
          kind: "changed",
          verified: true,
          summary: "Verified 1 explicit lineup change.",
          changes: [{ name: "Synthetic Skater", from: "BN", to: "C" }],
        },
      };
    case "blocked":
      return {
        ...base,
        _tag: "Blocked",
        outcome: {
          ...recorded,
          kind: "blocked",
          verified: false,
          summary: "The roster cannot be planned from the facts available now.",
        },
      };
    case "uncertain":
      return {
        ...base,
        _tag: "Uncertain",
        outcome: {
          ...recorded,
          kind: "uncertain",
          verified: false,
          summary: "The provider response could not be verified.",
        },
      };
    case "retry-wait":
      return {
        ...base,
        _tag: "RetryWait",
        attempt: 1,
        reason: "provider_unavailable",
        detail: "The provider could not be reached while reading the roster.",
        retryAt: DateTime.add(at, { minutes: 1 }),
      };
  }
}

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

function seedStoredGame(input: {
  readonly home: StoredClub;
  readonly away: StoredClub;
  readonly observedAt: DateTime.Utc;
}): Effect.Effect<void, never, ConnectionsDatabase> {
  return Effect.gen(function* () {
    const database = yield* ConnectionsDatabase;
    yield* database.insert(scheduleObservations).values({
      source: "nhl-web",
      subjectKind: "professional_game",
      subjectKey: "nhl:2026020201",
      observationKind: "professional_game",
      coversFrom: "2026-11-02",
      coversTo: "2026-11-08",
      value: {
        league: "nhl",
        date: "2026-11-02",
        startTime: { instant: "2026-11-02T23:00:00.000Z", timeZone: "US/Eastern" },
        home: storedClub(input.home),
        away: storedClub(input.away),
        venue: "Scotiabank Arena",
        status: "scheduled",
      },
      observedAt: DateTime.toDateUtc(input.observedAt),
      confidence: "authoritative",
      sourceReference: "2026020201",
    });
  }).pipe(Effect.orDie);
}

type StoredClub = {
  readonly identifier: string;
  readonly abbreviation: string;
  readonly name: string;
  readonly providerTeamKey: string | null;
};

function storedClub(club: StoredClub): unknown {
  return {
    providerTeamKey: club.providerTeamKey,
    sourceTeamIdentifier: club.identifier,
    sourceTeamAbbreviation: club.abbreviation,
    sourceTeamName: club.name,
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
        proTeamKey: "nhl.t.21",
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
    home: { identifier: "10", abbreviation: "TOR", name: "Toronto Maple Leafs" },
    away: { identifier: "6", abbreviation: "BOS", name: "Boston Bruins" },
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
