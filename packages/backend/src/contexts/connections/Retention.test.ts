import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, beforeEach, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { Array, Config, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect";

import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";
import { DatabaseConnection } from "#database/DatabaseConnection.ts";
import { PostgresLive } from "#database/internal/PostgresLive.ts";

import { StartLinkingInput } from "./Connection.ts";
import { Connections } from "./Connections.ts";
import type { TeamId } from "./FantasyTeam.ts";
import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabase } from "./internal/ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { LineupDeliveryLocal } from "./internal/LineupDeliveryLocal.ts";
import { LineupDispatcherLive } from "./internal/LineupDispatcherLive.ts";
import { LineupRunRepository } from "./internal/LineupRunRepository.ts";
import { LineupRunsLive } from "./internal/LineupRunsLive.ts";
import { LineupWorkerLive } from "./internal/LineupWorkerLive.ts";
import {
  FakeProviderWorld,
  ProviderFakeTest,
  refuseCustomPlanning,
} from "./internal/ProviderFakeTest.ts";
import { QueryRepository } from "./internal/QueryRepository.ts";
import { RetentionSweepLive } from "./internal/RetentionSweepRepository.ts";
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
    const thirtyDays = yield* retention.run(
      10,
      DateTime.addDuration(startedAt, 30 * 86_400_000 + 60_000),
    );
    const repeated = yield* retention.run(
      10,
      DateTime.addDuration(startedAt, 30 * 86_400_000 + 60_000),
    );
    const remaining = yield* runs.get(owner, { team });

    assert.deepStrictEqual(sixDays, {
      diagnostics: 0,
      attempts: 0,
      writeIntents: 0,
      runs: 0,
      requests: 0,
      deliveries: 0,
    });
    assert.strictEqual(sevenDays.diagnostics, 1);
    assert.strictEqual(sevenDays.runs, 0);
    assert.strictEqual(thirtyDays.runs, 1);
    assert.strictEqual(thirtyDays.requests, 1);
    assert.strictEqual(thirtyDays.deliveries, 1);
    assert.deepStrictEqual(repeated, {
      diagnostics: 0,
      attempts: 0,
      writeIntents: 0,
      runs: 0,
      requests: 0,
      deliveries: 0,
    });
    assert.strictEqual(remaining.runs.length, 1);
    assert.strictEqual(remaining.runs[0]?.run, queued.runs[0]?.id);
    assert.strictEqual(remaining.runs[0]?.status, "queued");
  }).pipe(Effect.provide(RetentionTestLayer)),
);

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
    const linkingInput = yield* Schema.decodeEffect(StartLinkingInput)({
      requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9169e2",
      provider: decodeProviderKey("yahoo"),
      pairingCode: "ABCD2345",
    });
    const linking = Array.getUnsafe(yield* connections.startLinking(owner, [linkingInput]), 0);
    yield* connections.completeLinking(owner, [
      { id: linking.id, provider: decodeProviderKey("yahoo"), session },
    ]);
    const found = yield* connections.discoverTeams(owner, [{ id: linking.id }]);
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
  teamCount: 10,
  format: "head_to_head_categories",
  scoringType: "head",
  scoringLabel: "H2H",
  weeklyDeadline: undefined,
  waiverType: "FR",
  waiverRule: "continuous",
  usesFaab: false,
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
      slot: "QB",
      isEditable: false,
      injuryCode: undefined,
      injuryDetail: undefined,
      byeWeek: 7,
      scheduled: true,
      startingLineup: "unconfirmed",
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
      isEditable: true,
      injuryCode: undefined,
      injuryDetail: undefined,
      byeWeek: 7,
      scheduled: true,
      startingLineup: "unconfirmed",
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
const RetentionTest = RetentionSweepLive.pipe(Layer.provide(DatabaseLayer));
const RetentionTestLayer = Layer.mergeAll(
  RetentionTest,
  RunsTest,
  ConnectionsTest,
  ProviderFakeTest,
  LineupRepositoryTest,
).pipe(
  Layer.provideMerge(DatabaseLayer),
  Layer.provideMerge(ProviderFakeTest),
  Layer.provide(EncryptionTestLayer),
  Layer.provide(NodeCrypto.layer),
  Layer.orDie,
);
