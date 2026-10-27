import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, beforeEach, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { and, eq } from "drizzle-orm";
import { Array, DateTime, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Config } from "effect";
import { TestClock } from "effect/testing";

import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";
import { DatabaseConnection } from "#database/DatabaseConnection.ts";
import { PostgresLive } from "#database/internal/PostgresLive.ts";

import { StartLinkingInput } from "./Connection.ts";
import { Connections } from "./Connections.ts";
import { decodeTeamId } from "./FantasyTeam.ts";
import type { TeamAutomation, TeamId } from "./FantasyTeam.ts";
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
import {
  FakeProviderWorld,
  ProviderFakeTest,
  refuseCustomPlanning,
} from "./internal/ProviderFakeTest.ts";
import { QueryRepository } from "./internal/QueryRepository.ts";
import { TeamRepository } from "./internal/TeamRepository.ts";
import { TeamsLive } from "./internal/TeamsLive.ts";
import { LineupRequestInput } from "./LineupRun.ts";
import { LineupRuns } from "./LineupRuns.ts";
import type { ProviderLeagueSettings, ProviderRoster, ProviderTeam } from "./Provider.ts";
import type { TeamAutomationAction, TeamControlResult } from "./Teams.ts";
import { TeamPersistenceFailed, Teams } from "./Teams.ts";

it.effect("enrolls, disables, and re-enrolls a team without deleting its configuration", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTeam(fake);

    const enabled = found(yield* control(teams, seeded, "enable"));
    const disabled = found(yield* control(teams, seeded, "disable"));
    const reenabled = found(yield* control(teams, seeded, "enable"));

    assert.strictEqual(enabled.outcome, "changed");
    assert.strictEqual(enabled.enrolled, true);
    assert.strictEqual(enabled.automation.status, "enabled");
    assert.strictEqual(disabled.outcome, "changed");
    assert.strictEqual(disabled.enrolled, false);
    assert.strictEqual(disabled.automation.status, "disabled");
    assert.strictEqual(reenabled.outcome, "changed");
    assert.strictEqual(reenabled.automation.status, "enabled");

    const current = yield* teams.get(owner, seeded);
    assert.strictEqual(current.team.name, "Alpha");
    assert.strictEqual(current.team.availability, "available");
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("pauses until the provider fantasy day ends and resumes explicitly", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const fake = yield* FakeProviderWorld;
    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-25T12:00:00Z")));
    const seeded = yield* seedTeam(fake);
    yield* control(teams, seeded, "enable");

    const paused = found(yield* control(teams, seeded, "pause-today"));
    const resumed = found(yield* control(teams, seeded, "resume"));

    assert.strictEqual(paused.outcome, "changed");
    assert.strictEqual(paused.enrolled, true);
    assert.strictEqual(paused.automation.status, "paused-until-fantasy-day-end");
    assert.strictEqual(paused.automation.timeZone, "America/Los_Angeles");
    assert.strictEqual(paused.automation.fantasyDay, "2026-10-25");
    assert.isDefined(paused.automation.resumesAt);
    assert.include(paused.detail, "paused until");
    assert.strictEqual(resumed.outcome, "changed");
    assert.strictEqual(resumed.enrolled, true);
    assert.strictEqual(resumed.automation.status, "enabled");
    assert.isUndefined(resumed.automation.resumesAt);
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("reports repeated actions as unchanged no-ops", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTeam(fake);

    yield* control(teams, seeded, "disable");
    const repeatedDisable = found(yield* control(teams, seeded, "disable"));
    yield* control(teams, seeded, "enable");
    const repeatedEnable = found(yield* control(teams, seeded, "enable"));
    const paused = found(yield* control(teams, seeded, "pause-today"));
    const repeatedPause = found(yield* control(teams, seeded, "pause-today"));
    yield* control(teams, seeded, "resume");
    const repeatedResume = found(yield* control(teams, seeded, "resume"));

    assert.strictEqual(repeatedDisable.outcome, "unchanged");
    assert.strictEqual(repeatedDisable.automation.status, "disabled");
    assert.strictEqual(repeatedEnable.outcome, "unchanged");
    assert.strictEqual(repeatedEnable.automation.status, "enabled");
    assert.strictEqual(repeatedPause.outcome, "unchanged");
    assert.deepStrictEqual(repeatedPause.automation.resumesAt, paused.automation.resumesAt);
    assert.strictEqual(repeatedResume.outcome, "unchanged");
    assert.strictEqual(repeatedResume.automation.status, "enabled");
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("rejects a mismatched action without changing the stored state", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTeam(fake);
    yield* control(teams, seeded, "enable");
    yield* control(teams, seeded, "pause-today");

    const enableWhilePaused = found(yield* control(teams, seeded, "enable"));
    yield* control(teams, seeded, "disable");
    const pauseWhileDisabled = found(yield* control(teams, seeded, "pause-today"));
    const resumeWhileDisabled = found(yield* control(teams, seeded, "resume"));

    assert.strictEqual(enableWhilePaused.outcome, "rejected");
    assert.strictEqual(enableWhilePaused.automation.status, "paused-until-fantasy-day-end");
    assert.include(enableWhilePaused.detail, "Use resume");
    assert.strictEqual(pauseWhileDisabled.outcome, "rejected");
    assert.strictEqual(pauseWhileDisabled.automation.status, "disabled");
    assert.include(pauseWhileDisabled.detail, "Enable it before pausing");
    assert.strictEqual(resumeWhileDisabled.outcome, "rejected");
    assert.strictEqual(resumeWhileDisabled.automation.status, "disabled");
    assert.include(resumeWhileDisabled.detail, "Enable it before resuming");
    assert.strictEqual((yield* teams.get(owner, seeded)).team.automation.status, "disabled");
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("keeps availability separate from the automation setting", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const database = yield* ConnectionsDatabase;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTeam(fake);
    yield* database
      .update(providerTeams)
      .set({ availability: "unavailable" })
      .where(and(eq(providerTeams.userId, owner), eq(providerTeams.id, seeded)));

    const enabled = found(yield* control(teams, seeded, "enable"));
    const repeated = found(yield* control(teams, seeded, "enable"));
    const paused = found(yield* control(teams, seeded, "pause-today"));
    const resumed = found(yield* control(teams, seeded, "resume"));

    assert.strictEqual(enabled.outcome, "changed");
    assert.strictEqual(enabled.enrolled, true);
    assert.strictEqual(enabled.availability, "unavailable");
    assert.include(enabled.detail, "unavailable");
    assert.strictEqual(repeated.outcome, "unchanged");
    assert.strictEqual(repeated.availability, "unavailable");
    assert.strictEqual(paused.outcome, "changed");
    assert.strictEqual(paused.automation.status, "paused-until-fantasy-day-end");
    assert.strictEqual(paused.availability, "unavailable");
    assert.include(paused.detail, "unavailable");
    assert.strictEqual(resumed.outcome, "changed");
    assert.strictEqual(resumed.automation.status, "enabled");
    assert.strictEqual(resumed.availability, "unavailable");
    const current = yield* teams.get(owner, seeded);
    assert.strictEqual(current.team.availability, "unavailable");
    assert.strictEqual(current.team.automation.status, "enabled");
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("hides another owner's team behind not-found and leaves it untouched", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTeam(fake);
    yield* control(teams, seeded, "enable");

    const foreign = Array.getUnsafe(
      yield* teams.control(other, [{ team: seeded, action: "disable" }]),
      0,
    );
    const current = yield* teams.get(owner, seeded);

    assert.strictEqual(foreign.outcome, "not_found");
    assert.strictEqual(foreign.team, seeded);
    assert.strictEqual(current.team.automation.status, "enabled");
    assert.deepStrictEqual(yield* teams.list(other), []);
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("serializes competing controls and never stores an invalid combination", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTeam(fake);
    yield* control(teams, seeded, "enable");

    const pausedOrDisabled = yield* Effect.all(
      [control(teams, seeded, "pause-today"), control(teams, seeded, "disable")],
      { concurrency: "unbounded" },
    );
    const afterPauseRace = yield* teams.get(owner, seeded);
    yield* control(teams, seeded, "enable");
    const enabledOrDisabled = yield* Effect.all(
      [control(teams, seeded, "enable"), control(teams, seeded, "disable")],
      { concurrency: "unbounded" },
    );
    const afterEnrollmentRace = yield* teams.get(owner, seeded);

    assert.strictEqual(pausedOrDisabled.length, 2);
    assert.isTrue(
      ["disabled", "paused-until-fantasy-day-end"].includes(afterPauseRace.team.automation.status),
    );
    assert.strictEqual(enabledOrDisabled.length, 2);
    assert.isTrue(["disabled", "enabled"].includes(afterEnrollmentRace.team.automation.status));
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("reports mixed batch outcomes in input order", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTeams(fake, seedTeamFixtures());
    const first = Array.getUnsafe(seeded, 0);
    const second = Array.getUnsafe(seeded, 1);
    const third = Array.getUnsafe(seeded, 2);
    const missing = decodeTeamId("00000000-0000-7000-8000-000000000099");
    yield* control(teams, first, "enable");

    const results = yield* teams.control(owner, [
      { team: first, action: "pause-today" },
      { team: second, action: "disable" },
      { team: third, action: "resume" },
      { team: missing, action: "enable" },
    ]);

    assert.strictEqual(results.length, 4);
    assert.strictEqual(Array.getUnsafe(results, 0).outcome, "changed");
    assert.strictEqual(Array.getUnsafe(results, 1).outcome, "unchanged");
    assert.strictEqual(Array.getUnsafe(results, 2).outcome, "rejected");
    assert.strictEqual(Array.getUnsafe(results, 3).outcome, "not_found");
    assert.strictEqual(
      found(Array.getUnsafe(results, 0)).automation.status,
      "paused-until-fantasy-day-end",
    );
    assert.strictEqual(found(Array.getUnsafe(results, 1)).automation.status, "disabled");
    assert.strictEqual(found(Array.getUnsafe(results, 2)).automation.status, "disabled");
    assert.strictEqual(
      (yield* teams.get(owner, first)).team.automation.status,
      "paused-until-fantasy-day-end",
    );
    assert.strictEqual((yield* teams.get(owner, second)).team.automation.status, "disabled");
    assert.strictEqual((yield* teams.get(owner, third)).team.automation.status, "disabled");
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("expires pauses only at the stored fantasy-day boundary", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const repository = yield* TeamRepository;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTeam(fake);
    yield* control(teams, seeded, "enable");
    yield* control(teams, seeded, "pause-today");
    const paused = yield* teams.get(owner, seeded);
    const resumesAt = requiredResumeBoundary(paused.team.automation);

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

it.effect("uses a 23-hour fantasy day across the spring DST transition", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const repository = yield* TeamRepository;
    const fake = yield* FakeProviderWorld;
    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-03-08T08:00:00Z")));
    const seeded = yield* seedTeam(fake);
    yield* control(teams, seeded, "enable");

    const paused = found(yield* control(teams, seeded, "pause-today"));
    const resumesAt = requiredResumeBoundary(paused.automation);
    const expired = yield* repository.expirePauses(10, resumesAt);

    assert.strictEqual(DateTime.formatIso(resumesAt), "2026-03-09T07:00:00.000Z");
    assert.strictEqual(expired.length, 1);
    assert.strictEqual((yield* teams.get(owner, seeded)).team.automation.status, "enabled");
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("uses a 25-hour fantasy day across the autumn DST transition", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const repository = yield* TeamRepository;
    const fake = yield* FakeProviderWorld;
    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-11-01T07:00:00Z")));
    const seeded = yield* seedTeam(fake);
    yield* control(teams, seeded, "enable");

    const paused = found(yield* control(teams, seeded, "pause-today"));
    const resumesAt = requiredResumeBoundary(paused.automation);
    const expired = yield* repository.expirePauses(10, resumesAt);

    assert.strictEqual(DateTime.formatIso(resumesAt), "2026-11-02T08:00:00.000Z");
    assert.strictEqual(expired.length, 1);
    assert.strictEqual((yield* teams.get(owner, seeded)).team.automation.status, "enabled");
  }).pipe(Effect.provide(TeamsTestLayer)),
);

it.effect("includes the latest verified run in team activity", () =>
  Effect.gen(function* () {
    const teams = yield* Teams;
    const runs = yield* LineupRuns;
    const fake = yield* FakeProviderWorld;
    const seeded = yield* seedTeam(fake);
    yield* refuseCustomPlanning(fake);
    yield* control(teams, seeded, "enable");

    const submitted = yield* runs.submit(owner, lineupRequest(seeded));
    const detail = yield* teams.get(owner, seeded);

    assert.strictEqual(submitted.runs[0]?.status, "completed");
    assert.strictEqual(detail.lastRun?.run, submitted.runs[0]?.run);
    assert.strictEqual(detail.lastRun?.outcome?.kind, "changed");
    assert.strictEqual(detail.recentRuns.length, 1);
    assert.strictEqual(detail.connectionStatus, "ready");
  }).pipe(Effect.provide(TeamsTestLayer)),
);

function control(
  teams: Teams["Service"],
  team: TeamId,
  action: TeamAutomationAction,
): Effect.Effect<TeamControlResult, TeamPersistenceFailed> {
  return teams
    .control(owner, [{ team, action }])
    .pipe(Effect.map((results) => Array.getUnsafe(results, 0)));
}

function found(
  result: TeamControlResult,
): Exclude<TeamControlResult, { readonly outcome: "not_found" }> {
  if (result.outcome === "not_found") {
    throw new Error(`Expected an owned team result for ${result.team}`);
  }
  return result;
}

function requiredResumeBoundary(automation: TeamAutomation): DateTime.Utc {
  if (automation.resumesAt === undefined) {
    throw new Error("A paused team is missing its resume boundary");
  }
  return automation.resumesAt;
}

function lineupRequest(team: TeamId): LineupRequestInput {
  return Schema.decodeSync(LineupRequestInput)({
    requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164e1",
    teams: [{ team, period: { coverage: "week", week: 3 } }],
  });
}

function seedTeam(fake: FakeProviderWorld["Service"]): Effect.Effect<TeamId, never, Connections> {
  return seedTeams(fake, [teamFixture]).pipe(Effect.map((teams) => Array.getUnsafe(teams, 0)));
}

function seedTeams(
  fake: FakeProviderWorld["Service"],
  fixtures: ReadonlyArray<ProviderTeam>,
): Effect.Effect<ReadonlyArray<TeamId>, never, Connections> {
  return Effect.gen(function* () {
    const connections = yield* Connections;
    yield* fake.setTeams(fixtures);
    yield* fake.setLeague(league);
    yield* fake.setRoster(roster);
    yield* fake.setNativeAfter(nativeAfter);
    const linkingInput = yield* Schema.decodeEffect(StartLinkingInput)({
      requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164e2",
      provider: decodeProviderKey("yahoo"),
      pairingCode: "ABCD2345",
    });
    const linking = Array.getUnsafe(yield* connections.startLinking(owner, [linkingInput]), 0);
    yield* connections.completeLinking(owner, [
      { id: linking.id, provider: decodeProviderKey("yahoo"), session },
    ]);
    const foundTeams = yield* connections.discoverTeams(owner, [{ id: linking.id }]);
    return foundTeams.map((team) => team.id);
  }).pipe(Effect.orDie);
}

let owner = decodeUserId("automation-owner-1");
const other = decodeUserId("automation-other");
const session = Redacted.make("A1=test-session-cookie");

let ownerSerial = 0;
beforeEach(() => {
  ownerSerial += 1;
  owner = decodeUserId(`automation-owner-${String(ownerSerial)}`);
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

const additionalTeams: ReadonlyArray<ProviderTeam> = [
  {
    ...teamFixture,
    providerTeamKey: "461.l.1000.t.2",
    name: "Beta",
  },
  {
    ...teamFixture,
    providerTeamKey: "461.l.1000.t.3",
    name: "Gamma",
  },
];

function seedTeamFixtures(): ReadonlyArray<ProviderTeam> {
  return [teamFixture, ...additionalTeams];
}

const league: ProviderLeagueSettings = {
  providerLeagueKey: "461.l.1000",
  name: "Alpha League",
  webUrl: "https://football.fantasysports.yahoo.com/f1/1000",
  season: 2026,
  periodWindow: { current: 3, start: 1, end: 17 },
  rosterCoverage: "week",
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
  Layer.provide(ProviderFakeTest),
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
).pipe(
  Layer.provideMerge(DatabaseLayer),
  Layer.provideMerge(ProviderFakeTest),
  Layer.provide(EncryptionTestLayer),
  Layer.provide(NodeCrypto.layer),
  Layer.orDie,
);
