import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, beforeEach, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { and, eq } from "drizzle-orm";
import { Array, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Config } from "effect";

import { DatabaseConnection } from "#database/DatabaseConnection.ts";
import { PostgresLive } from "#database/internal/PostgresLive.ts";

import { StartLinkingInput } from "./Connection.ts";
import { Connections } from "./Connections.ts";
import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabase } from "./internal/ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { providerTeams } from "./internal/ConnectionTables.ts";
import { LineupDeliveryLocal } from "./internal/LineupDeliveryLocal.ts";
import { LineupDispatcherLive } from "./internal/LineupDispatcherLive.ts";
import { LineupRunRepository } from "./internal/LineupRunRepository.ts";
import { LineupRunsLive } from "./internal/LineupRunsLive.ts";
import { LineupWorkerLive } from "./internal/LineupWorkerLive.ts";
import { FakeProviderWorld, ProviderFakeTest } from "./internal/ProviderFakeTest.ts";
import { QueryRepository } from "./internal/QueryRepository.ts";
import { TeamRepository } from "./internal/TeamRepository.ts";
import { TeamsLive } from "./internal/TeamsLive.ts";
import { LineupRequestInput } from "./LineupRun.ts";
import { LineupRuns } from "./LineupRuns.ts";
import { TeamControlRejected, TeamNotFound, Teams } from "./Teams.ts";
import type { ProviderLeagueSettings, ProviderRoster, ProviderTeam } from "./Provider.ts";

it.effect("enrolls, pauses through the provider day, and keeps availability separate", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const database = yield* ConnectionsDatabase;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTeam(fake);
    const before = yield* DateTime.now;

    const enabled = yield* teams.setEnabled(owner, [{ team: seeded, enabled: true }]);
    const paused = yield* teams.pause(owner, [{ team: seeded }]);
    const first = Array.getUnsafe(paused, 0).team.automation;

    assert.strictEqual(Array.getUnsafe(enabled, 0).team.automation.status, "enabled");
    assert.strictEqual(first.status, "paused-until-fantasy-day-end");
    assert.strictEqual(first.timeZone, "America/Los_Angeles");
    assert.isDefined(first.resumesAt);
    assert.isAtLeast(
      DateTime.toEpochMillis(first.resumesAt ?? before),
      DateTime.toEpochMillis(before),
    );
    assert.isAtMost(
      DateTime.toEpochMillis(first.resumesAt ?? before),
      DateTime.toEpochMillis(DateTime.addDuration(before, 25 * 3_600_000)),
    );

    const replayed = yield* teams.pause(owner, [{ team: seeded }]);
    assert.deepStrictEqual(
      Array.getUnsafe(replayed, 0).team.automation.resumesAt,
      first.resumesAt,
    );

    yield* database
      .update(providerTeams)
      .set({ availability: "unavailable" })
      .where(and(eq(providerTeams.userId, owner), eq(providerTeams.id, seeded)));
    const listed = yield* teams.get(owner, seeded);

    assert.strictEqual(listed.team.availability, "unavailable");
    assert.strictEqual(listed.team.automation.status, "paused-until-fantasy-day-end");
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("disables a paused team and rejects enabling it without clearing the pause", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTeam(fake);
    yield* teams.setEnabled(owner, [{ team: seeded, enabled: true }]);
    yield* teams.pause(owner, [{ team: seeded }]);

    const rejected = yield* Effect.flip(
      teams.setEnabled(owner, [{ team: seeded, enabled: true }]),
    );
    const disabled = yield* teams.setEnabled(owner, [{ team: seeded, enabled: false }]);
    const reenabled = yield* teams.setEnabled(owner, [{ team: seeded, enabled: true }]);

    assert.instanceOf(rejected, TeamControlRejected);
    assert.strictEqual(Array.getUnsafe(disabled, 0).team.automation.status, "disabled");
    assert.strictEqual(Array.getUnsafe(reenabled, 0).team.automation.status, "enabled");
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("serializes competing controls and keeps another owner out", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTeam(fake);
    yield* teams.setEnabled(owner, [{ team: seeded, enabled: true }]);

    const changes = yield* Effect.all(
      [
        teams.pause(owner, [{ team: seeded }]),
        teams.setEnabled(owner, [{ team: seeded, enabled: false }]),
      ],
      { concurrency: "unbounded" },
    );
    const current = yield* teams.get(owner, seeded);
    const foreign = yield* Effect.flip(teams.get(other, seeded));

    assert.strictEqual(changes.length, 2);
    assert.isTrue(["disabled", "paused-until-fantasy-day-end"].includes(current.team.automation.status));
    assert.instanceOf(foreign, TeamNotFound);
    assert.deepStrictEqual(yield* teams.list(other), []);
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("includes the latest verified run in team activity", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const runs = yield* LineupRuns;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTeam(fake);
    yield* teams.setEnabled(owner, [{ team: seeded, enabled: true }]);

    const submitted = yield* runs.submit(owner, lineupRequest(seeded));
    const detail = yield* teams.get(owner, seeded);

    assert.strictEqual(submitted.runs[0]?.status, "completed");
    assert.strictEqual(detail.lastRun?.run, submitted.runs[0]?.run);
    assert.strictEqual(detail.lastRun?.outcome?.kind, "changed");
    assert.strictEqual(detail.recentRuns.length, 1);
    assert.strictEqual(detail.connectionStatus, "ready");
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("expires pauses only at the stored fantasy-day boundary", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const repository = yield* TeamRepository;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTeam(fake);
    yield* teams.setEnabled(owner, [{ team: seeded, enabled: true }]);
    yield* teams.pause(owner, [{ team: seeded }]);
    const paused = yield* teams.get(owner, seeded);
    const resumesAt = paused.team.automation.resumesAt;
    if (resumesAt === undefined) {
      return;
    }

    const notYet = yield* repository.expirePauses(
      10,
      DateTime.subtractDuration(resumesAt, "1 millis"),
    );
    const expired = yield* repository.expirePauses(10, resumesAt);
    const after = yield* teams.get(owner, seeded);
    const repeated = yield* repository.expirePauses(10, resumesAt);

    assert.deepStrictEqual(notYet, []);
    assert.strictEqual(expired.length, 1);
    assert.strictEqual(after.team.automation.status, "enabled");
    assert.deepStrictEqual(repeated, []);
  }).pipe(Effect.provide(TeamsTestLayer)),
);

function lineupRequest(team: import("./FantasyTeam.ts").TeamId): LineupRequestInput {
  return Schema.decodeSync(LineupRequestInput)({
    requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164e1",
    teams: [{ team, period: { coverage: "week", week: 3 } }],
  });
}

function seedTeam(
  fake: FakeProviderWorld["Service"],
): Effect.Effect<import("./FantasyTeam.ts").TeamId, never, Connections> {
  return Effect.gen(function* () {
    const connections = yield* Connections;
    yield* fake.setTeams([teamFixture]);
    yield* fake.setLeague(league);
    yield* fake.setRoster(roster);
    yield* fake.setNativeAfter(nativeAfter);
    const linkingInput = yield* Schema.decodeEffect(StartLinkingInput)({
      requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164e2",
      provider: "yahoo",
      pairingCode: "ABCD2345",
    });
    const linking = Array.getUnsafe(yield* connections.startLinking(owner, [linkingInput]), 0);
    yield* connections.completeLinking(owner, [{ id: linking.id, provider: "yahoo", session }]);
    const found = yield* connections.discoverTeams(owner, [{ id: linking.id }]);
    return Array.getUnsafe(found, 0).id;
  }).pipe(Effect.orDie);
}

let owner = decodeUserId("automation-owner-1");
const other = decodeUserId("automation-other");
const session = Redacted.make("A1=test-session-cookie");

beforeEach(() => {
  owner = decodeUserId(`automation-owner-${String(Math.random())}`);
});

const teamFixture: ProviderTeam = {
  provider: "yahoo",
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
  currentWeek: 3,
  startWeek: 1,
  endWeek: 17,
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
const TeamsRepositoryTest = TeamRepository.layer.pipe(Layer.provide(DatabaseLayer));
const TeamsTest = TeamsLive.pipe(
  Layer.provide(TeamsRepositoryTest),
  Layer.provide(LineupRepositoryTest),
);
const TeamsTestLayer = Layer.mergeAll(
  TeamsTest,
  TeamsRepositoryTest,
  RunsTest,
  ConnectionsTest,
  ProviderFakeTest,
).pipe(
  Layer.provideMerge(DatabaseLayer),
  Layer.provideMerge(ProviderFakeTest),
  Layer.provide(EncryptionTestLayer),
  Layer.provide(NodeCrypto.layer),
  Layer.orDie,
);
