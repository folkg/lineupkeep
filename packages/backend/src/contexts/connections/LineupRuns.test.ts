import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, beforeEach, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { and, eq } from "drizzle-orm";
import { Array, Config, Deferred, Effect, Fiber, Layer, Option, Redacted, Schema } from "effect";
import { DateTime } from "effect";

import { DatabaseConnection } from "#database/DatabaseConnection.ts";
import { PostgresLive } from "#database/internal/PostgresLive.ts";

import type { ConnectionId } from "./Connection.ts";
import { StartLinkingInput } from "./Connection.ts";
import { Connections } from "./Connections.ts";
import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabase } from "./internal/ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { providerCredentials, providerTeams } from "./internal/ConnectionTables.ts";
import { LineupDeliveryLocal } from "./internal/LineupDeliveryLocal.ts";
import { LineupDispatcherLive } from "./internal/LineupDispatcherLive.ts";
import { LineupRunRepository } from "./internal/LineupRunRepository.ts";
import { LineupRunsLive } from "./internal/LineupRunsLive.ts";
import { LineupWorkerLive } from "./internal/LineupWorkerLive.ts";
import { FakeProviderWorld, ProviderFakeTest } from "./internal/ProviderFakeTest.ts";
import { QueryRepository } from "./internal/QueryRepository.ts";
import { TeamAutomationState } from "./internal/TeamAutomationWorkflow.ts";
import { LineupRequestConflict, LineupRequestInput, LineupRunNotFound } from "./LineupRun.ts";
import { LineupRuns } from "./LineupRuns.ts";
import { LineupWorker } from "./LineupWork.ts";
import type { ProviderLeagueSettings, ProviderRoster, ProviderTeam } from "./Provider.ts";

it.effect("creates one durable run per team and verifies the native change", () =>
  Effect.gen(function* () {
    const runs = yield* LineupRuns;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedOne(fake, teamFixture("461.l.1000.t.1", "Alpha"));

    const submitted = yield* runs.submit(owner, lineupRequest(team.id, requestId));

    assert.strictEqual(submitted.delivery, "queued");
    assert.strictEqual(submitted.runs.length, 1);
    assert.strictEqual(submitted.runs[0]?.status, "completed");
    assert.strictEqual(submitted.runs[0]?.implementation, "provider_native");
    assert.strictEqual(submitted.runs[0]?.implementationVersion, "provider-native/1");
    assert.strictEqual(submitted.runs[0]?.outcome?.kind, "changed");
    assert.strictEqual(submitted.runs[0]?.outcome?.verified, true);
    assert.strictEqual(submitted.runs[0]?.outcome?.reconciled, false);
    assert.strictEqual(submitted.runs[0]?.outcome?.lockedPlayers, 1);
    assert.strictEqual(submitted.runs[0]?.outcome?.editablePlayers, 1);
    assert.strictEqual(yield* fake.nativeCallCount, 1);

    const replay = yield* runs.submit(owner, lineupRequest(team.id, requestId));
    assert.deepStrictEqual(
      replay.runs.map((run) => run.run),
      submitted.runs.map((run) => run.run),
    );
    assert.strictEqual(yield* fake.nativeCallCount, 1);

    const conflict = yield* Effect.flip(
      runs.submit(owner, lineupRequest(team.id, requestId, { coverage: "week", week: 4 })),
    );
    assert.instanceOf(conflict, LineupRequestConflict);

    const listed = yield* runs.get(owner, { request: requestId });
    assert.strictEqual(listed.status, "ok");
    assert.strictEqual(listed.runs.length, 1);
    assert.strictEqual(listed.page.complete, true);

    const foreign = yield* Effect.flip(
      runs.get(other, { runs: submitted.runs.map((run) => run.run) }),
    );
    assert.instanceOf(foreign, LineupRunNotFound);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("reconciles a lost provider response only when readback proves the change", () =>
  Effect.gen(function* () {
    const runs = yield* LineupRuns;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedOne(fake, teamFixture("461.l.1000.t.1", "Alpha"));
    yield* fake.setNativeAction("lost_response");

    const submitted = yield* runs.submit(owner, lineupRequest(team.id, requestId));

    assert.strictEqual(submitted.runs[0]?.status, "completed");
    assert.strictEqual(submitted.runs[0]?.outcome?.kind, "changed");
    assert.strictEqual(submitted.runs[0]?.outcome?.verified, true);
    assert.strictEqual(submitted.runs[0]?.outcome?.reconciled, true);
    assert.strictEqual(yield* fake.nativeCallCount, 1);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("keeps a lost response uncertain when readback does not prove a change", () =>
  Effect.gen(function* () {
    const runs = yield* LineupRuns;
    const worker = yield* LineupWorker;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedOne(fake, teamFixture("461.l.1000.t.1", "Alpha"));
    yield* fake.setNativeAction("lost_response");
    yield* fake.setNativeAfter(undefined);

    const submitted = yield* runs.submit(owner, lineupRequest(team.id, requestId));
    const run = submitted.runs[0];
    assert.strictEqual(run?.status, "uncertain");
    assert.strictEqual(run?.outcome?.kind, "uncertain");
    assert.strictEqual(run?.outcome?.verified, false);
    assert.strictEqual(yield* fake.nativeCallCount, 1);
    if (run === undefined) {
      return;
    }

    yield* worker.deliver([run.run]);
    assert.strictEqual(yield* fake.nativeCallCount, 1);
    const after = yield* runs.get(owner, { runs: [run.run] });
    assert.strictEqual(after.runs[0]?.status, "uncertain");
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("reports a definitive provider rejection as failed, never completed", () =>
  Effect.gen(function* () {
    const runs = yield* LineupRuns;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedOne(fake, teamFixture("461.l.1000.t.1", "Alpha"));
    yield* fake.setNativeAction("reject");

    const submitted = yield* runs.submit(owner, lineupRequest(team.id, requestId));

    assert.strictEqual(submitted.runs[0]?.status, "failed");
    assert.strictEqual(submitted.runs[0]?.outcome?.kind, "failed");
    assert.strictEqual(submitted.runs[0]?.outcome?.verified, false);
    assert.strictEqual(yield* fake.nativeCallCount, 1);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("lets a manual run bypass pause and enrollment after observation", () =>
  Effect.gen(function* () {
    const runs = yield* LineupRuns;
    const database = yield* ConnectionsDatabase;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedOne(fake, teamFixture("461.l.1000.t.1", "Alpha"));
    const gate = yield* fake.blockRosterRead;

    const fiber = yield* Effect.forkChild(runs.submit(owner, lineupRequest(team.id, requestId)));
    yield* Deferred.await(gate.started);
    yield* database
      .update(providerTeams)
      .set({
        automationState: yield* Schema.encodeEffect(Schema.toCodecJson(TeamAutomationState))({
          _tag: "PausedUntilFantasyDayEnd",
          changedAt: DateTime.makeUnsafe("2026-10-25T12:00:00Z"),
          pausedAt: DateTime.makeUnsafe("2026-10-25T12:00:00Z"),
          resumesAt: DateTime.makeUnsafe("2026-10-26T07:00:00Z"),
          timeZone: "America/Los_Angeles",
          fantasyDay: "2026-10-25",
          policyVersion: "yahoo-pacific-midnight/1",
        }),
        automationStatus: "paused-until-fantasy-day-end",
      })
      .where(and(eq(providerTeams.userId, owner), eq(providerTeams.id, team.id)));
    yield* Deferred.succeed(gate.release, undefined);
    const submitted = yield* Fiber.join(fiber);

    assert.strictEqual(submitted.runs[0]?.status, "completed");
    assert.strictEqual(submitted.runs[0]?.outcome?.kind, "changed");
    assert.strictEqual(yield* fake.nativeCallCount, 1);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("blocks when the connection credential generation changes after observation", () =>
  Effect.gen(function* () {
    const runs = yield* LineupRuns;
    const database = yield* ConnectionsDatabase;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedOne(fake, teamFixture("461.l.1000.t.1", "Alpha"));
    const gate = yield* fake.blockRosterRead;

    const fiber = yield* Effect.forkChild(runs.submit(owner, lineupRequest(team.id, requestId)));
    yield* Deferred.await(gate.started);
    yield* database
      .update(providerCredentials)
      .set({ generation: 2 })
      .where(
        and(
          eq(providerCredentials.userId, owner),
          eq(providerCredentials.connectionId, team.connectionId),
        ),
      );
    yield* Deferred.succeed(gate.release, undefined);
    const submitted = yield* Fiber.join(fiber);

    assert.strictEqual(submitted.runs[0]?.status, "blocked");
    assert.strictEqual(yield* fake.nativeCallCount, 0);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("blocks when the connection is disconnected after observation", () =>
  Effect.gen(function* () {
    const runs = yield* LineupRuns;
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedOne(fake, teamFixture("461.l.1000.t.1", "Alpha"));
    const gate = yield* fake.blockRosterRead;

    const fiber = yield* Effect.forkChild(runs.submit(owner, lineupRequest(team.id, requestId)));
    yield* Deferred.await(gate.started);
    yield* connections.disconnect(owner, [{ id: team.connectionId }]);
    yield* Deferred.succeed(gate.release, undefined);
    const submitted = yield* Fiber.join(fiber);

    assert.strictEqual(submitted.runs[0]?.status, "blocked");
    assert.strictEqual(yield* fake.nativeCallCount, 0);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("serializes duplicate workers and does not replay a completed team", () =>
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const worker = yield* LineupWorker;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedOne(fake, teamFixture("461.l.1000.t.1", "Alpha"));
    const created = yield* repository.createRequest({
      userId: owner,
      requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a4",
      intent: "duplicate-workers",
      runs: [
        {
          team: team.id,
          connectionId: team.connectionId,
          target: { coverage: "week", week: 3 },
          trigger: "manual",
        },
      ],
    });
    const runId = created.runs[0]?.id;
    if (runId === undefined) {
      return;
    }
    const gate = yield* fake.blockRosterRead;

    const first = yield* Effect.forkChild(worker.deliver([runId]));
    yield* Deferred.await(gate.started);
    const second = yield* Effect.forkChild(worker.deliver([runId]));
    yield* Deferred.succeed(gate.release, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);

    assert.strictEqual(yield* fake.nativeCallCount, 1);
    yield* worker.deliver([runId]);
    assert.strictEqual(yield* fake.nativeCallCount, 1);
    const loaded = yield* repository.loadRuns(owner, { runs: [runId], limit: 1 });
    assert.strictEqual(loaded.runs[0]?.status, "completed");
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("keeps a partial multi-team batch honest and never replays a completed team", () =>
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const database = yield* ConnectionsDatabase;
    const worker = yield* LineupWorker;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seed(fake, [
      teamFixture("461.l.1000.t.1", "Alpha"),
      teamFixture("461.l.1000.t.2", "Beta"),
    ]);
    const [first, second] = seeded;
    if (first === undefined || second === undefined) {
      return;
    }
    yield* database
      .update(providerTeams)
      .set({ availability: "unavailable" })
      .where(and(eq(providerTeams.userId, owner), eq(providerTeams.id, second.id)));
    const created = yield* repository.createRequest({
      userId: owner,
      requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a5",
      intent: "partial-batch",
      runs: [
        {
          team: first.id,
          connectionId: first.connectionId,
          target: { coverage: "week", week: 3 },
          trigger: "manual",
        },
        {
          team: second.id,
          connectionId: second.connectionId,
          target: { coverage: "week", week: 3 },
          trigger: "manual",
        },
      ],
    });

    yield* worker.deliver(created.runs.map((run) => run.id));

    assert.strictEqual(yield* fake.nativeCallCount, 1);
    const loaded = yield* repository.loadRuns(owner, {
      request: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a5",
      limit: 10,
    });
    const statusByTeam = new Map(loaded.runs.map((run) => [run.teamId, run.status]));
    assert.strictEqual(statusByTeam.get(first.id), "completed");
    assert.strictEqual(statusByTeam.get(second.id), "blocked");
    yield* worker.deliver(created.runs.map((run) => run.id));
    assert.strictEqual(yield* fake.nativeCallCount, 1);
  }).pipe(Effect.provide(LineupTestLayer)),
);

function lineupRequest(
  team: import("./FantasyTeam.ts").TeamId,
  requestId: string,
  period: import("./LineupRun.ts").LineupTargetPeriod = { coverage: "week", week: 3 },
): LineupRequestInput {
  return Schema.decodeSync(LineupRequestInput)({
    requestId,
    teams: [{ team, period }],
  });
}

function seedOne(
  fake: FakeProviderWorld["Service"],
  team: ProviderTeam,
): Effect.Effect<
  { readonly id: import("./FantasyTeam.ts").TeamId; readonly connectionId: ConnectionId },
  never,
  Connections
> {
  return seed(fake, [team]).pipe(
    Effect.flatMap((rows) => {
      const first = rows[0];
      return first === undefined
        ? Effect.die(new Error("The seed did not discover a team"))
        : Effect.succeed(first);
    }),
  );
}

function seed(
  fake: FakeProviderWorld["Service"],
  teams: ReadonlyArray<ProviderTeam>,
): Effect.Effect<
  ReadonlyArray<{
    readonly id: import("./FantasyTeam.ts").TeamId;
    readonly connectionId: ConnectionId;
  }>,
  never,
  Connections
> {
  return Effect.gen(function* () {
    const connections = yield* Connections;
    yield* fake.setTeams(teams);
    yield* fake.setLeague(league);
    yield* fake.setRoster(roster);
    yield* fake.setNativeAfter(nativeAfter);
    const linkingInput = yield* Schema.decodeEffect(StartLinkingInput)({
      requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2",
      provider: "yahoo",
      pairingCode: "ABCD2345",
    });
    const linking = Array.getUnsafe(yield* connections.startLinking(owner, [linkingInput]), 0);
    yield* connections.completeLinking(owner, [{ id: linking.id, provider: "yahoo", session }]);
    const discovered = yield* connections.discoverTeams(owner, [{ id: linking.id }]);
    return discovered.map((row) => ({ id: row.id, connectionId: row.connectionId }));
  }).pipe(Effect.orDie);
}

function teamFixture(providerTeamKey: string, name: string): ProviderTeam {
  return {
    provider: "yahoo",
    providerTeamKey,
    providerLeagueKey: "461.l.1000",
    league: "nfl",
    sport: "football",
    season: 2026,
    name,
  };
}

const requestId = "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2";
let ownerSerial = 0;
let owner = decodeUserId(`owner-${String(++ownerSerial)}`);
beforeEach(() => {
  owner = decodeUserId(`owner-${String(++ownerSerial)}`);
});
const other = decodeUserId("other");
const session = Redacted.make("A1=test-session-cookie");

const league: ProviderLeagueSettings = {
  providerLeagueKey: "461.l.1000",
  name: "Alpha League",
  webUrl: "https://football.fantasysports.yahoo.com/f1/1000",
  season: 2026,
  periodWindow: { currentWeek: 3, startWeek: 1, endWeek: 17 },
  startDate: "2026-09-03",
  endDate: "2026-12-28",
  teamCount: 10,
  scoringType: "head",
  scoringLabel: "H2H",
  weeklyDeadline: undefined,
  waiverType: "FR",
  waiverRule: "continuous",
  usesFaab: false,
  draftStatus: "postdraft",
  rosterPositions: [
    { position: "QB", positionType: "O", count: 1, isStarting: true },
    { position: "BN", positionType: "B", count: 1, isStarting: false },
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
      slot: "QB",
      isFlex: false,
      isEditable: false,
      injuryCode: undefined,
      injuryDetail: undefined,
      byeWeek: 7,
      undroppable: false,
    },
    {
      providerPlayerKey: "461.p.10002",
      name: "Movable Bench",
      displayPosition: "QB",
      primaryPosition: "QB",
      positionType: "O",
      proTeamAbbreviation: undefined,
      eligiblePositions: ["QB"],
      slot: "BN",
      isFlex: false,
      isEditable: true,
      injuryCode: undefined,
      injuryDetail: undefined,
      byeWeek: 7,
      undroppable: false,
    },
  ],
};

const nativeAfter: ProviderRoster = {
  ...roster,
  players: roster.players.map((player, index) => ({
    ...player,
    slot: index === 0 ? "BN" : "QB",
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
const LineupTestLayer = Layer.mergeAll(
  RunsTest,
  WorkerTest,
  DispatcherTest,
  LineupRepositoryTest,
  ConnectionsTest,
  ProviderFakeTest,
).pipe(
  Layer.provideMerge(DatabaseLayer),
  Layer.provideMerge(ProviderFakeTest),
  Layer.provide(EncryptionTestLayer),
  Layer.provide(NodeCrypto.layer),
  Layer.orDie,
);
