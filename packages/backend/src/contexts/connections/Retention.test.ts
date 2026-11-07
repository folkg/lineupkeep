import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, beforeEach, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { Array, Config, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect";

import { AccountRetentionLive } from "#contexts/auth/internal/AccountRetentionLive.ts";
import { AccountRetentionRepository } from "#contexts/auth/internal/AccountRetentionRepository.ts";
import { AuthDatabase } from "#contexts/auth/internal/AuthDatabase.ts";
import { AuthDatabaseTest } from "#contexts/auth/internal/AuthDatabaseTest.ts";
import { OAuthClientRepository } from "#contexts/auth/internal/OAuthClientRepository.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";
import { DatabaseConnection } from "#database/DatabaseConnection.ts";
import { PostgresLive } from "#database/internal/PostgresLive.ts";

import { Connections } from "./Connections.ts";
import { decodeTeamId } from "./FantasyTeam.ts";
import type { TeamId } from "./FantasyTeam.ts";
import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabase } from "./internal/ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { hostedLinkingSessions } from "./internal/HostedLinkingTables.ts";
import { LineupDeliveryLocal } from "./internal/LineupDeliveryLocal.ts";
import { LineupDispatcherLive } from "./internal/LineupDispatcherLive.ts";
import { LineupRunRepository } from "./internal/LineupRunRepository.ts";
import { LineupRunsLive } from "./internal/LineupRunsLive.ts";
import { lineupRunAttempts, lineupRuns, lineupWriteIntents } from "./internal/LineupRunTables.ts";
import { LineupWorkerLive } from "./internal/LineupWorkerLive.ts";
import {
  FakeProviderWorld,
  ProviderFakeTest,
  refuseCustomPlanning,
} from "./internal/ProviderFakeTest.ts";
import { QueryRepository } from "./internal/QueryRepository.ts";
import { RetentionSweepLive } from "./internal/RetentionSweepRepository.ts";
import { ScheduleGateTest } from "./internal/ScheduleGateTest.ts";
import { ScheduleObservationRepository } from "./internal/ScheduleObservationRepository.ts";
import { LineupRequestInput } from "./LineupRun.ts";
import { LineupRuns } from "./LineupRuns.ts";
import type { ProviderLeagueSettings, ProviderRoster, ProviderTeam } from "./Provider.ts";
import { RetentionSweep } from "./Retention.ts";

it.effect("removes expired diagnostics and outcomes without touching unresolved work", () =>
  Effect.gen(function* () {
    const runs = yield* LineupRuns;
    const repository = yield* LineupRunRepository;
    const retention = yield* RetentionSweep;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTeam(fake);
    yield* refuseCustomPlanning(fake);
    const team = seeded.team;
    const startedAt = yield* DateTime.now;

    const completed = yield* runs.submit(owner, lineupRequest(team));
    const queued = yield* repository.createScheduledRuns({
      userId: owner,
      at: startedAt,
      runs: [{ team, connectionId: seeded.connectionId }],
    });
    assert.strictEqual(completed.runs[0]?.status, "completed");
    assert.strictEqual(queued.runs.length, 1);

    const sixDays = yield* retention.run(10, DateTime.addDuration(startedAt, 6 * 86_400_000));
    const sevenDays = yield* retention.run(
      10,
      DateTime.addDuration(startedAt, 7 * 86_400_000 + 60_000),
    );
    const ninetyDays = yield* retention.run(
      10,
      DateTime.addDuration(startedAt, 90 * 86_400_000 + 60_000),
    );
    const repeated = yield* retention.run(
      10,
      DateTime.addDuration(startedAt, 90 * 86_400_000 + 60_000),
    );
    const remaining = yield* runs.get(owner, { team });

    assert.strictEqual(sixDays.diagnostics, 0);
    assert.strictEqual(sixDays.runs, 0);
    assert.strictEqual(sevenDays.diagnostics, 1);
    assert.strictEqual(sevenDays.runs, 0);
    assert.strictEqual(ninetyDays.runs, 1);
    assert.strictEqual(ninetyDays.requests, 1);
    assert.strictEqual(ninetyDays.deliveries, 1);
    assert.strictEqual(repeated.runs, 0);
    assert.strictEqual(repeated.requests, 0);
    assert.strictEqual(repeated.deliveries, 0);
    assert.strictEqual(remaining.runs.length, 1);
    assert.strictEqual(remaining.runs[0]?.run, queued.runs[0]?.id);
    assert.strictEqual(remaining.runs[0]?.status, "queued");
  }).pipe(Effect.provide(RetentionTestLayer)),
);

it.effect(
  "removes a terminal run, its attempts and its write intents after 90 whole days and keeps a run at 89 days",
  () =>
    Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;
      const retention = yield* RetentionSweep;
      const at = DateTime.makeUnsafe("2026-06-30T12:00:00.000Z");
      const removedAt = DateTime.subtractDuration(at, 90 * 86_400_000);
      const keptAt = DateTime.subtractDuration(at, 89 * 86_400_000);
      const removedRun = "018f79ea-7d86-7c18-9b4a-8b4d0c916001";
      const keptRun = "018f79ea-7d86-7c18-9b4a-8b4d0c916002";

      yield* database
        .insert(lineupRuns)
        .values([terminalRun(removedRun, removedAt), terminalRun(keptRun, keptAt)]);
      yield* database
        .insert(lineupRunAttempts)
        .values([attemptOf(removedRun, removedAt), attemptOf(keptRun, keptAt)]);
      yield* database
        .insert(lineupWriteIntents)
        .values([
          writeIntentOf("018f79ea-7d86-7c18-9b4a-8b4d0c916020", removedRun, removedAt),
          writeIntentOf("018f79ea-7d86-7c18-9b4a-8b4d0c916021", keptRun, keptAt),
        ]);

      const summary = yield* retention.run(10, at);
      const runs = yield* database.select({ id: lineupRuns.id }).from(lineupRuns);
      const intents = yield* database
        .select({ runId: lineupWriteIntents.runId })
        .from(lineupWriteIntents);

      assert.strictEqual(summary.runs, 1);
      assert.strictEqual(summary.attempts, 1);
      assert.strictEqual(summary.writeIntents, 1);
      assert.deepStrictEqual(
        runs.map((run) => run.id),
        [keptRun],
      );
      assert.deepStrictEqual(
        intents.map((intent) => intent.runId),
        [keptRun],
      );
    }).pipe(Effect.provide(RetentionTestLayer)),
);

it.effect("prunes schedule observations 14 days after their covered window ends", () =>
  Effect.gen(function* () {
    const store = yield* ScheduleObservationRepository;
    const retention = yield* RetentionSweep;
    const team = decodeTeamId("00000000-0000-7000-8000-000000000002");
    const at = DateTime.makeUnsafe("2026-06-30T12:00:00.000Z");
    const windows = [15, 14, 13].map((days) =>
      DateTime.formatIsoDate(DateTime.subtractDuration(at, days * 86_400_000)),
    );
    yield* store.recordProviderOpponents({
      subjectKey: team,
      source: decodeProviderKey("yahoo"),
      confidence: "authoritative",
      observations: windows.map((window) => ({
        window: { from: window, to: window },
        value: { players: [] },
        observedAt: at,
        sourceReference: "retention-fixture",
      })),
    });

    const summary = yield* retention.run(10, at);
    assert.strictEqual(summary.scheduleObservations, 2);

    const remaining = yield* Effect.forEach(windows, (window) =>
      store.readProviderOpponents({ subjectKey: team, from: window, to: window }),
    );
    assert.deepStrictEqual(
      remaining.map((rows) => rows.length),
      [0, 0, 1],
    );
  }).pipe(Effect.provide(RetentionTestLayer)),
);

it.effect("removes finished hosted linking sessions after a day and keeps a live one", () =>
  Effect.gen(function* () {
    const database = yield* ConnectionsDatabase;
    const retention = yield* RetentionSweep;
    const at = DateTime.makeUnsafe("2026-06-30T12:00:00.000Z");
    const startedAt = DateTime.subtractDuration(at, 3 * 86_400_000);
    const finishedAt = DateTime.subtractDuration(at, 2 * 86_400_000);
    const boundaryAt = DateTime.subtractDuration(at, 86_400_000);
    const liveStartedAt = DateTime.subtractDuration(at, 60_000);

    yield* database
      .insert(hostedLinkingSessions)
      .values([
        hostedLinkingSession("finished-session", "completed", startedAt, finishedAt),
        hostedLinkingSession("expired-session", "expired", startedAt, finishedAt),
        hostedLinkingSession("boundary-session", "completed", startedAt, boundaryAt),
        hostedLinkingSession("live-session", "active", liveStartedAt, at),
      ]);

    const summary = yield* retention.run(10, at);
    const remaining = yield* database
      .select({ id: hostedLinkingSessions.id })
      .from(hostedLinkingSessions);

    assert.strictEqual(summary.hostedLinkingSessions, 3);
    assert.deepStrictEqual(
      remaining.map((session) => session.id),
      ["live-session"],
    );
  }).pipe(Effect.provide(RetentionTestLayer)),
);

it.effect("keeps an in-flight run and its write intent at the retention boundary", () =>
  Effect.gen(function* () {
    const database = yield* ConnectionsDatabase;
    const retention = yield* RetentionSweep;
    const at = DateTime.makeUnsafe("2026-06-30T12:00:00.000Z");
    const boundary = DateTime.subtractDuration(at, 90 * 86_400_000);
    const inFlightRun = "018f79ea-7d86-7c18-9b4a-8b4d0c916003";

    yield* database
      .insert(lineupRuns)
      .values([{ ...terminalRun(inFlightRun, boundary), status: "applying" }]);
    yield* database
      .insert(lineupWriteIntents)
      .values([writeIntentOf("018f79ea-7d86-7c18-9b4a-8b4d0c916022", inFlightRun, boundary)]);

    const summary = yield* retention.run(10, at);
    const runs = yield* database.select({ id: lineupRuns.id }).from(lineupRuns);
    const intents = yield* database
      .select({ runId: lineupWriteIntents.runId })
      .from(lineupWriteIntents);

    assert.strictEqual(summary.runs, 0);
    assert.strictEqual(summary.writeIntents, 0);
    assert.deepStrictEqual(
      runs.map((run) => run.id),
      [inFlightRun],
    );
    assert.deepStrictEqual(
      intents.map((intent) => intent.runId),
      [inFlightRun],
    );
  }).pipe(Effect.provide(RetentionTestLayer)),
);

function terminalRun(id: string, at: DateTime.Utc): typeof lineupRuns.$inferInsert {
  return {
    id,
    userId: owner,
    requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9169e2",
    teamId: decodeTeamId("00000000-0000-7000-8000-000000000021"),
    connectionId: "connection-1",
    trigger: "manual",
    scheduleKey: null,
    target: { coverage: "current" },
    status: "completed",
    state: {},
    implementation: "custom_policy",
    implementationVersion: "custom-policy/2",
    attempts: 1,
    nextActionAt: null,
    createdAt: DateTime.toDateUtc(at),
    updatedAt: DateTime.toDateUtc(at),
  };
}

function attemptOf(runId: string, at: DateTime.Utc): typeof lineupRunAttempts.$inferInsert {
  return {
    runId,
    attempt: 1,
    leaseToken: "018f79ea-7d86-7c18-9b4a-8b4d0c916010",
    leaseGeneration: 1,
    startedAt: DateTime.toDateUtc(at),
    finishedAt: DateTime.toDateUtc(at),
    outcome: "completed",
  };
}

function writeIntentOf(
  id: string,
  runId: string,
  at: DateTime.Utc,
): typeof lineupWriteIntents.$inferInsert {
  return {
    id,
    runId,
    attempt: 1,
    userId: owner,
    teamId: decodeTeamId("00000000-0000-7000-8000-000000000021"),
    connectionId: "connection-1",
    connectionGeneration: 1,
    leaseToken: "018f79ea-7d86-7c18-9b4a-8b4d0c916010",
    leaseGeneration: 1,
    action: "native_action",
    target: { coverage: "current" },
    before: {},
    plan: null,
    status: "verified_changed",
    createdAt: DateTime.toDateUtc(at),
    updatedAt: DateTime.toDateUtc(at),
  };
}

function hostedLinkingSession(
  id: string,
  status: "completed" | "expired" | "active",
  startedAt: DateTime.Utc,
  endedAt: DateTime.Utc,
): typeof hostedLinkingSessions.$inferInsert {
  return {
    id,
    userId: owner,
    connectionId: status === "completed" ? "connection-1" : null,
    provider: "yahoo",
    status,
    ticketHash: `hash-${id}`,
    startedAt: DateTime.toDateUtc(startedAt),
    expiresAt: DateTime.toDateUtc(
      status === "active" ? DateTime.addDuration(startedAt, 600_000) : endedAt,
    ),
    completedAt: status === "completed" ? DateTime.toDateUtc(endedAt) : null,
    cancelledAt: null,
    expiredAt: status === "expired" ? DateTime.toDateUtc(endedAt) : null,
    failedAt: null,
    failureReason: null,
    createdAt: DateTime.toDateUtc(startedAt),
    updatedAt: DateTime.toDateUtc(endedAt),
  };
}

function lineupRequest(team: TeamId): LineupRequestInput {
  return Schema.decodeSync(LineupRequestInput)({
    requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9169e1",
    teams: [{ team, period: { coverage: "week", week: 3 } }],
  });
}

function seedTeam(
  fake: FakeProviderWorld["Service"],
): Effect.Effect<
  { readonly team: TeamId; readonly connectionId: import("./Connection.ts").ConnectionId },
  never,
  Connections
> {
  return Effect.gen(function* () {
    const connections = yield* Connections;
    yield* fake.setTeams([teamFixture]);
    yield* fake.setLeague(league);
    yield* fake.setRoster(roster);
    yield* fake.setNativeAfter(nativeAfter);
    const linked = Array.getUnsafe(
      yield* connections.link(owner, [{ provider: decodeProviderKey("yahoo"), session }]),
      0,
    );
    const found = yield* connections.discoverTeams(owner, [{ id: linked.id }]);
    const team = Array.getUnsafe(found, 0);
    return { team: team.id, connectionId: team.connectionId };
  }).pipe(Effect.orDie);
}

let owner = decodeUserId("retention-owner-1");
let ownerSerial = 0;
const session = Redacted.make("A1=test-session-cookie");

beforeEach(() => {
  ownerSerial += 1;
  owner = decodeUserId(`retention-owner-${String(ownerSerial)}`);
});

const teamFixture: ProviderTeam = {
  provider: decodeProviderKey("yahoo"),
  providerTeamKey: "461.l.1000.t.1",
  providerLeagueKey: "461.l.1000",
  league: "nfl",
  sport: "football",
  season: 2026,
  name: "Alpha",
};

const league: ProviderLeagueSettings = {
  providerLeagueKey: "461.l.1000",
  name: "Alpha League",
  webUrl: "https://football.fantasysports.yahoo.com/f1/1000",
  season: 2026,
  periodWindow: { current: 3, start: 1, end: 17 },
  rosterCoverage: "week",
  maxGamesPlayed: undefined,
  maxInningsPitched: undefined,
  startDate: "2026-09-03",
  endDate: "2026-12-28",
  currentDate: undefined,
  teamCount: 10,
  format: "head_to_head_categories",
  scoringType: "head",
  scoringLabel: "H2H",
  weeklyDeadline: undefined,
  rosterChange: undefined,
  waiverType: "FR",
  waiverRule: "continuous",
  usesFaab: false,
  waiverDays: undefined,
  maxWeeklyAcquisitions: undefined,
  maxSeasonAcquisitions: undefined,
  tradeEndDate: undefined,
  tradeRatification: undefined,
  tradeDraftPicks: undefined,
  tradeObjectionDays: undefined,
  draftStatus: "postdraft",
  rosterPositions: [
    { position: "QB", positionType: "O", count: 1, kind: "starting", eligibility: ["QB"] },
    { position: "BN", positionType: "B", count: 1, kind: "bench", eligibility: [] },
  ],
  statCategories: [],
  statModifiers: [],
};

const roster: ProviderRoster = {
  providerTeamKey: "461.l.1000.t.1",
  providerLeagueKey: "461.l.1000",
  coverage: { type: "week", week: 3 },
  players: [
    {
      providerPlayerKey: "461.p.10001",
      name: "Locked Starter",
      displayPosition: "QB",
      primaryPosition: "QB",
      positionType: "O",
      proTeamAbbreviation: undefined,
      eligiblePositions: ["QB"],
      slot: { status: "verified", slot: "QB" },
      isEditable: false,
      injuryCode: undefined,
      injuryDetail: undefined,
      byeWeek: 7,
      scheduled: true,
      startingLineup: "unconfirmed",
      undroppable: false,
      transactionTrend: {
        status: "not_published",
        reason: "Synthetic absence.",
      },
    },
    {
      providerPlayerKey: "461.p.10002",
      name: "Movable Bench",
      displayPosition: "QB",
      primaryPosition: "QB",
      positionType: "O",
      proTeamAbbreviation: undefined,
      eligiblePositions: ["QB"],
      slot: { status: "verified", slot: "BN" },
      isEditable: true,
      injuryCode: undefined,
      injuryDetail: undefined,
      byeWeek: 7,
      scheduled: true,
      startingLineup: "unconfirmed",
      undroppable: false,
      transactionTrend: {
        status: "not_published",
        reason: "Synthetic absence.",
      },
    },
  ],
};

const nativeAfter: ProviderRoster = {
  ...roster,
  players: roster.players.map((player, index) => ({
    ...player,
    slot: { status: "verified", slot: index === 0 ? "BN" : "QB" },
  })),
};

const EncryptionTestLayer = ConnectionCredentialEncryption.forKey(
  ConnectionEncryptionKey.fromBytes({
    bytes: new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz012345"),
    keyVersion: 1,
  }),
).pipe(Layer.provide(NodeCrypto.layer));

const databaseUrl = Option.getOrUndefined(
  Effect.runSync(Config.option(Config.String("DATABASE_URL"))),
);
const DatabaseLayer =
  databaseUrl === undefined
    ? ConnectionsDatabaseTest.pipe(Layer.orDie)
    : ConnectionsDatabase.layer.pipe(
        Layer.provide(PostgresLive),
        Layer.provide(
          DatabaseConnection.fromConnectionString({
            connectionString: () => databaseUrl,
            prepareStatements: true,
          }),
        ),
        Layer.orDie,
      );
const ConnectionRepositoryTest = ConnectionRepository.layer.pipe(Layer.provide(DatabaseLayer));
const QueryRepositoryTest = QueryRepository.layer.pipe(Layer.provide(ConnectionRepositoryTest));
const LineupRepositoryTest = LineupRunRepository.layer.pipe(Layer.provide(DatabaseLayer));
const WorkerTest = LineupWorkerLive.pipe(
  Layer.provide(LineupRepositoryTest),
  Layer.provide(QueryRepositoryTest),
  Layer.provide(EncryptionTestLayer),
  Layer.provideMerge(ProviderFakeTest),
  Layer.provide(ScheduleGateTest),
);
const DeliveryTest = LineupDeliveryLocal.pipe(Layer.provide(WorkerTest));
const DispatcherTest = LineupDispatcherLive.pipe(
  Layer.provide(LineupRepositoryTest),
  Layer.provide(DeliveryTest),
);
const RunsTest = LineupRunsLive.pipe(
  Layer.provide(LineupRepositoryTest),
  Layer.provide(QueryRepositoryTest),
  Layer.provide(DispatcherTest),
);
const ConnectionsTest = ConnectionsLive.pipe(
  Layer.provide(ConnectionRepositoryTest),
  Layer.provideMerge(ProviderFakeTest),
  Layer.provide(EncryptionTestLayer),
);
const ScheduleObservationRepositoryTest = ScheduleObservationRepository.layer.pipe(
  Layer.provide(DatabaseLayer),
);
const AuthDatabaseLayer =
  databaseUrl === undefined
    ? AuthDatabaseTest.pipe(Layer.orDie)
    : AuthDatabase.layer.pipe(
        Layer.provide(
          DatabaseConnection.fromConnectionString({
            connectionString: () => databaseUrl,
            prepareStatements: true,
          }),
        ),
        Layer.orDie,
      );
const AccountRetentionTest = AccountRetentionLive.pipe(
  Layer.provide(OAuthClientRepository.layer),
  Layer.provide(AccountRetentionRepository.layer),
  Layer.provide(AuthDatabaseLayer),
);
const RetentionTestLayer = Layer.mergeAll(
  RetentionSweepLive.pipe(Layer.provide(AccountRetentionTest), Layer.provide(DatabaseLayer)),
  RunsTest,
  ConnectionsTest,
  ProviderFakeTest,
  LineupRepositoryTest,
  ScheduleObservationRepositoryTest,
).pipe(
  Layer.provideMerge(DatabaseLayer),
  Layer.provideMerge(ProviderFakeTest),
  Layer.provide(EncryptionTestLayer),
  Layer.provide(NodeCrypto.layer),
  Layer.orDie,
);
