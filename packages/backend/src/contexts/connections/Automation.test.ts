import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, beforeEach, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { eq } from "drizzle-orm";
import { Array, Config, Effect, Layer, Option, Redacted, Schema } from "effect";
import { DateTime, Duration } from "effect";
import { TestClock } from "effect/testing";

import { AccountRetention } from "#contexts/auth/AccountRetention.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";
import { DatabaseConnection } from "#database/DatabaseConnection.ts";
import { PostgresLive } from "#database/internal/PostgresLive.ts";

import { Automation } from "./Automation.ts";
import { Connections } from "./Connections.ts";
import type { TeamId } from "./FantasyTeam.ts";
import { AutomationLive } from "./internal/AutomationLive.ts";
import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionCredentialRepository } from "./internal/ConnectionCredentialRepository.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabase } from "./internal/ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { providerTeams } from "./internal/ConnectionTables.ts";
import { CredentialKeyCensusLive } from "./internal/CredentialKeyCensusLive.ts";
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
import { ScheduleGateTest } from "./internal/ScheduleGateTest.ts";
import { TeamRepository } from "./internal/TeamRepository.ts";
import { TeamsLive } from "./internal/TeamsLive.ts";
import { LineupRequestId, LineupRequestInput } from "./LineupRun.ts";
import { LineupRuns } from "./LineupRuns.ts";
import type { ProviderLeagueSettings, ProviderRoster, ProviderTeam } from "./Provider.ts";
import { Teams } from "./Teams.ts";

it.effect("runs one current-period automation per team per hour", () =>
  Effect.gen(function* () {
    const automation = yield* Automation;
    const runs = yield* LineupRuns;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedTeam(fake, "461.l.1000.t.1", "Alpha");
    yield* refuseCustomPlanning(fake);
    const teams = yield* Teams;
    yield* teams.control(owner, [{ team, action: "enable" }]);

    const first = yield* automation.run(10);
    const current = yield* runs.get(owner, { team });

    assert.strictEqual(first.eligibleTeams, 1);
    assert.strictEqual(first.scheduledRuns, 1);
    assert.strictEqual(first.delivered, 1);
    assert.strictEqual(current.runs.length, 1);
    assert.deepStrictEqual(current.runs[0]?.target, { coverage: "current" });
    assert.strictEqual(current.runs[0]?.trigger, "scheduled");
    assert.strictEqual(current.runs[0]?.implementation, "custom_policy");
    assert.strictEqual(current.runs[0]?.outcome?.implementation, "provider_native");
    assert.strictEqual(current.runs[0]?.status, "completed");
    assert.strictEqual(yield* fake.nativeCallCount, 1);

    const duplicate = yield* automation.run(10);
    assert.strictEqual(duplicate.scheduledRuns, 0);
    assert.strictEqual(yield* fake.nativeCallCount, 1);

    yield* TestClock.adjust(3_600_000);
    const nextHour = yield* automation.run(10);
    assert.strictEqual(nextHour.scheduledRuns, 1);
    assert.strictEqual(yield* fake.nativeCallCount, 2);
  }).pipe(Effect.provide(AutomationTestLayer)),
);

it.effect("reports stored credential key versions with the maintenance tick", () =>
  Effect.gen(function* () {
    const automation = yield* Automation;
    const fake = yield* FakeProviderWorld;
    yield* refuseCustomPlanning(fake);
    yield* seedTeam(fake, "461.l.1000.t.1", "Alpha");

    const summary = yield* automation.run(10);

    assert.strictEqual(summary.credentialKeys.currentKeyVersion, 1);
    assert.deepStrictEqual(summary.credentialKeys.usage, [{ keyVersion: 1, envelopes: 1 }]);
    assert.strictEqual(summary.credentialKeys.olderEnvelopes, 0);
    assert.strictEqual(summary.credentialKeys.unreadableEnvelopes, 0);
  }).pipe(Effect.provide(AutomationTestLayer)),
);

it.effect("checks all five owner teams at minute 55 without repeating an hour's period", () =>
  Effect.gen(function* () {
    const automation = yield* Automation;
    const runs = yield* LineupRuns;
    const fake = yield* FakeProviderWorld;
    const teams = yield* Teams;
    const seeded = yield* seedOwnerTeams(fake, 5);
    yield* refuseCustomPlanning(fake);
    yield* teams.control(
      owner,
      seeded.map((team) => ({ team, action: "enable" as const })),
    );

    const scheduled: Array<number> = [];
    for (const at of ["2026-10-26T13:55:00Z", "2026-10-26T14:55:00Z", "2026-10-26T15:55:00Z"]) {
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(at)));
      scheduled.push((yield* automation.run(50)).scheduledRuns);
    }

    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-26T15:59:00Z")));
    const retried = yield* automation.run(50);
    const activity = yield* runs.get(owner, { limit: 50 });

    assert.deepStrictEqual(scheduled, [5, 5, 5]);
    assert.strictEqual(retried.scheduledRuns, 0);
    assert.strictEqual(activity.runs.length, 15);
    assert.deepStrictEqual([...new Set(activity.runs.map((run) => run.trigger))], ["scheduled"]);
    assert.deepStrictEqual(
      [...new Set(activity.runs.map((run) => DateTime.formatIso(run.createdAt)))].sort(),
      ["2026-10-26T13:55:00.000Z", "2026-10-26T14:55:00.000Z", "2026-10-26T15:55:00.000Z"],
    );

    const manual = yield* runs.submit(
      owner,
      yield* Schema.decodeEffect(LineupRequestInput)({
        requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164e9",
        teams: [{ team: Array.getUnsafe(seeded, 0), period: { coverage: "current" } }],
      }),
    );

    assert.strictEqual(manual.runs[0]?.trigger, "manual");
    assert.strictEqual(manual.runs[0]?.status, "completed");
  }).pipe(Effect.provide(AutomationTestLayer)),
);

it.effect("collapses several missed hourly ticks into one current run", () =>
  Effect.gen(function* () {
    const automation = yield* Automation;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedTeam(fake, "461.l.1000.t.1", "Alpha");
    yield* refuseCustomPlanning(fake);
    const teams = yield* Teams;
    yield* teams.control(owner, [{ team, action: "enable" }]);

    yield* TestClock.adjust(5 * 3_600_000);
    const summary = yield* automation.run(10);

    assert.strictEqual(summary.scheduledRuns, 1);
    assert.strictEqual(summary.delivered, 1);
    assert.strictEqual(yield* fake.nativeCallCount, 1);
  }).pipe(Effect.provide(AutomationTestLayer)),
);

it.effect("excludes disabled and paused teams but still schedules an available-flag team", () =>
  Effect.gen(function* () {
    const automation = yield* Automation;
    const fake = yield* FakeProviderWorld;
    const teams = yield* Teams;
    const database = yield* ConnectionsDatabase;
    const disabled = yield* seedTeam(fake, "461.l.1000.t.1", "Alpha");
    const paused = yield* seedTeam(fake, "461.l.1000.t.2", "Beta");
    const unavailableKey = "461.l.1000.t.3";
    const unavailable = yield* seedTeam(fake, unavailableKey, "Gamma", {
      team: teamFixture,
      league,
      roster: { ...roster, providerTeamKey: unavailableKey },
      nativeAfter: { ...nativeAfter, providerTeamKey: unavailableKey },
    });
    yield* refuseCustomPlanning(fake);
    yield* teams.control(owner, [
      { team: paused, action: "enable" },
      { team: unavailable, action: "enable" },
    ]);
    yield* teams.control(owner, [{ team: paused, action: "pause-today" }]);
    yield* database
      .update(providerTeams)
      .set({ availability: "unavailable" })
      .where(eq(providerTeams.id, unavailable));

    const summary = yield* automation.run(10);

    assert.strictEqual(summary.eligibleTeams, 1);
    assert.strictEqual(summary.scheduledRuns, 1);
    assert.strictEqual(summary.delivered, 1);
    assert.strictEqual(yield* fake.nativeCallCount, 1);
    assert.notStrictEqual(disabled, paused);
  }).pipe(Effect.provide(AutomationTestLayer)),
);

it.effect("completes a current hockey run in a rotisserie league with no scoring weeks", () =>
  Effect.gen(function* () {
    const runs = yield* LineupRuns;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedTeam(fake, "465.l.2000.t.9", "Gamma", {
      team: hockeyTeamFixture,
      league: { ...hockeyLeague, scoringType: "roto", periodWindow: undefined },
      roster: hockeyRoster,
      nativeAfter: hockeyNativeAfter,
    });
    yield* refuseCustomPlanning(fake);
    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-25T19:00:00Z")));
    const requested = yield* Schema.decodeEffect(LineupRequestInput)({
      requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164f9",
      teams: [{ team, period: { coverage: "current" } }],
    });

    const submitted = yield* runs.submit(owner, requested);

    assert.strictEqual(submitted.runs[0]?.status, "completed");
    assert.strictEqual(submitted.runs[0]?.outcome?.kind, "changed");
    assert.deepStrictEqual(yield* fake.rosterPeriods, [
      { type: "date", date: "2026-10-25" },
      { type: "date", date: "2026-10-25" },
    ]);
    assert.deepStrictEqual(yield* fake.nativeTargets, [{ type: "date", date: "2026-10-25" }]);
    assert.strictEqual(yield* fake.nativeCallCount, 1);
  }).pipe(Effect.provide(AutomationTestLayer)),
);

it.effect("resolves the current fantasy day for a head-to-head hockey league with weeks", () =>
  Effect.gen(function* () {
    const runs = yield* LineupRuns;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedTeam(fake, "465.l.2000.t.9", "Gamma", {
      team: hockeyTeamFixture,
      league: hockeyLeague,
      roster: hockeyRoster,
      nativeAfter: hockeyNativeAfter,
    });
    yield* refuseCustomPlanning(fake);
    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-25T19:00:00Z")));
    const requested = yield* Schema.decodeEffect(LineupRequestInput)({
      requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164fa",
      teams: [{ team, period: { coverage: "current" } }],
    });

    const submitted = yield* runs.submit(owner, requested);

    assert.strictEqual(submitted.runs[0]?.status, "completed");
    assert.deepStrictEqual(yield* fake.rosterPeriods, [
      { type: "date", date: "2026-10-25" },
      { type: "date", date: "2026-10-25" },
    ]);
    assert.deepStrictEqual(yield* fake.nativeTargets, [{ type: "date", date: "2026-10-25" }]);
    assert.strictEqual(yield* fake.nativeCallCount, 1);
  }).pipe(Effect.provide(AutomationTestLayer)),
);

it.effect("blocks a current hockey run outside the declared season with the actual cause", () =>
  Effect.gen(function* () {
    const runs = yield* LineupRuns;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedTeam(fake, "465.l.2000.t.9", "Gamma", {
      team: hockeyTeamFixture,
      league: { ...hockeyLeague, periodWindow: undefined },
      roster: hockeyRoster,
      nativeAfter: hockeyNativeAfter,
    });
    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2027-05-01T19:00:00Z")));
    const requested = yield* Schema.decodeEffect(LineupRequestInput)({
      requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164fb",
      teams: [{ team, period: { coverage: "current" } }],
    });

    const submitted = yield* runs.submit(owner, requested);

    assert.strictEqual(submitted.runs[0]?.status, "blocked");
    assert.include(submitted.runs[0]?.outcome?.summary, "outside the league's declared season");
    assert.deepStrictEqual(yield* fake.rosterPeriods, []);
    assert.strictEqual(yield* fake.nativeCallCount, 0);
  }).pipe(Effect.provide(AutomationTestLayer)),
);

it.effect("repairs an undispatched scheduled delivery before scheduling another", () =>
  Effect.gen(function* () {
    const automation = yield* Automation;
    const repository = yield* LineupRunRepository;
    const runs = yield* LineupRuns;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedTeam(fake, "461.l.1000.t.1", "Alpha");
    yield* refuseCustomPlanning(fake);
    const teams = yield* Teams;
    yield* teams.control(owner, [{ team, action: "enable" }]);
    const now = yield* DateTime.now;
    const pending = yield* repository.createScheduledRuns({
      userId: owner,
      at: now,
      runs: [{ team, connectionId: (yield* teams.get(owner, team)).team.connectionId }],
    });
    assert.strictEqual(pending.runs.length, 1);

    const summary = yield* automation.run(10);
    const loaded = yield* runs.get(owner, { team });

    assert.strictEqual(summary.scheduledRuns, 0);
    assert.strictEqual(summary.delivered, 1);
    assert.strictEqual(loaded.runs[0]?.run, pending.runs[0]?.id);
    assert.strictEqual(loaded.runs[0]?.status, "completed");
    assert.strictEqual(yield* fake.nativeCallCount, 1);
  }).pipe(Effect.provide(AutomationTestLayer)),
);

it.effect("recovers a queued run whose delivery was dispatched but never claimed", () =>
  Effect.gen(function* () {
    const automation = yield* Automation;
    const repository = yield* LineupRunRepository;
    const runs = yield* LineupRuns;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedTeam(fake, "461.l.1000.t.1", "Alpha");
    yield* refuseCustomPlanning(fake);
    const teams = yield* Teams;
    yield* teams.control(owner, [{ team, action: "enable" }]);
    const at = yield* DateTime.now;
    const queued = yield* repository.createScheduledRuns({
      userId: owner,
      at,
      runs: [{ team, connectionId: (yield* teams.get(owner, team)).team.connectionId }],
    });
    const deliveries = yield* repository.claimDeliveries(at, 10);
    yield* repository.finishDeliveries(
      deliveries.map((record) => ({ deliveryId: record.id, at, outcome: "dispatched" as const })),
    );
    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.addDuration(at, Duration.minutes(3))));

    const summary = yield* automation.run(10);
    const loaded = yield* runs.get(owner, { team });

    assert.strictEqual(summary.scheduledRuns, 0);
    assert.strictEqual(summary.delivered, 1);
    assert.strictEqual(loaded.runs[0]?.run, queued.runs[0]?.id);
    assert.strictEqual(loaded.runs[0]?.status, "completed");
  }).pipe(Effect.provide(AutomationTestLayer)),
);

it.effect("treats a team with an in-flight manual run as busy for scheduling", () =>
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedTeam(fake, "461.l.1000.t.1", "Alpha");
    const teams = yield* Teams;
    const at = yield* DateTime.now;
    const created = yield* repository.createRequest({
      userId: owner,
      requestId: yield* Schema.decodeEffect(LineupRequestId)(
        "018f79ea-7d86-7c18-9b4a-8b4d0c9164fc",
      ),
      intent: '{"trigger":"manual"}',
      runs: [
        {
          team,
          connectionId: (yield* teams.get(owner, team)).team.connectionId,
          trigger: "manual",
          target: { coverage: "current" },
        },
      ],
    });
    const run = Array.getUnsafe(created.runs, 0);
    assert.isTrue(Option.isSome(yield* repository.claim(run.id, at)));

    const busy = yield* repository.scheduledTeamIds([team]);

    assert.isTrue(busy.has(team));
  }).pipe(Effect.provide(AutomationTestLayer)),
);

it.effect("blocks a stale explicit week instead of replaying or editing a future period", () =>
  Effect.gen(function* () {
    const runs = yield* LineupRuns;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedTeam(fake, "461.l.1000.t.1", "Alpha");
    const requested = yield* Schema.decodeEffect(LineupRequestInput)({
      requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164f1",
      teams: [{ team, period: { coverage: "week", week: 1 } }],
    });

    const submitted = yield* runs.submit(owner, requested);

    assert.strictEqual(submitted.runs[0]?.status, "blocked");
    assert.strictEqual(yield* fake.nativeCallCount, 0);
  }).pipe(Effect.provide(AutomationTestLayer)),
);

type SeedShape = {
  readonly team: ProviderTeam;
  readonly league: ProviderLeagueSettings;
  readonly roster: ProviderRoster;
  readonly nativeAfter: ProviderRoster;
};

function seedOwnerTeams(
  fake: FakeProviderWorld["Service"],
  count: number,
): Effect.Effect<ReadonlyArray<TeamId>, never, Connections> {
  return Effect.gen(function* () {
    const connections = yield* Connections;
    yield* fake.setTeams(
      Array.range(1, count).map((index) => ({
        ...teamFixture,
        providerTeamKey: `461.l.1000.t.${String(index)}`,
        name: `Team ${String(index)}`,
      })),
    );
    yield* fake.setLeague(league);
    yield* fake.setRoster(roster);
    yield* fake.setNativeAfter(nativeAfter);
    const linked = Array.getUnsafe(
      yield* connections.link(owner, [{ provider: decodeProviderKey("yahoo"), session }]),
      0,
    );
    const found = yield* connections.discoverTeams(owner, [{ id: linked.id }]);
    return found.map((team) => team.id);
  }).pipe(Effect.orDie);
}

function seedTeam(
  fake: FakeProviderWorld["Service"],
  providerTeamKey: string,
  name: string,
  shape: SeedShape = { team: teamFixture, league, roster, nativeAfter },
): Effect.Effect<TeamId, never, Connections> {
  return Effect.gen(function* () {
    const connections = yield* Connections;
    yield* fake.setTeams([{ ...shape.team, providerTeamKey, name }]);
    yield* fake.setLeague(shape.league);
    yield* fake.setRoster(shape.roster);
    yield* fake.setNativeAfter(shape.nativeAfter);
    const linked = Array.getUnsafe(
      yield* connections.link(owner, [{ provider: decodeProviderKey("yahoo"), session }]),
      0,
    );
    const found = yield* connections.discoverTeams(owner, [{ id: linked.id }]);
    return Array.getUnsafe(found, 0).id;
  }).pipe(Effect.orDie);
}

let owner = decodeUserId("automation-tick-owner-1");
let ownerSerial = 0;
const session = Redacted.make("A1=test-session-cookie");

beforeEach(() => {
  ownerSerial += 1;
  owner = decodeUserId(`automation-tick-owner-${String(ownerSerial)}`);
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
  rosterConstraints: {
    rosterMaximum: 2,
    benchCapacity: "generic",
    startingSlotsMayStandEmpty: true,
    reserveEligibility: { kind: "published_positions" },
  },
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

const hockeyTeamFixture: ProviderTeam = {
  ...teamFixture,
  providerTeamKey: "465.l.2000.t.9",
  providerLeagueKey: "465.l.2000",
  league: "nhl",
  sport: "hockey",
  name: "Gamma",
};

const hockeyLeague: ProviderLeagueSettings = {
  providerLeagueKey: "465.l.2000",
  name: "Hockey League",
  webUrl: "https://hockey.fantasysports.yahoo.com/hockey/2000",
  season: 2026,
  periodWindow: { current: 3, start: 1, end: 24 },
  rosterCoverage: "date",
  maxGamesPlayed: undefined,
  maxInningsPitched: undefined,
  startDate: "2026-10-01",
  endDate: "2027-04-10",
  currentDate: undefined,
  teamCount: 10,
  format: "head_to_head_categories",
  scoringType: "head",
  scoringLabel: "H2H",
  weeklyDeadline: "daily",
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
    { position: "C", positionType: "P", count: 2, kind: "starting", eligibility: ["C"] },
    { position: "BN", positionType: "B", count: 2, kind: "bench", eligibility: [] },
  ],
  rosterConstraints: {
    rosterMaximum: 4,
    benchCapacity: "generic",
    startingSlotsMayStandEmpty: true,
    reserveEligibility: { kind: "published_positions" },
  },
  statCategories: [],
  statModifiers: [],
};

const hockeyRoster: ProviderRoster = {
  providerTeamKey: "465.l.2000.t.9",
  providerLeagueKey: "465.l.2000",
  coverage: { type: "date", date: "2026-10-25" },
  players: [
    {
      providerPlayerKey: "465.p.90001",
      name: "Locked Center",
      displayPosition: "C",
      primaryPosition: "C",
      positionType: "P",
      proTeamAbbreviation: undefined,
      eligiblePositions: ["C"],
      slot: { status: "verified", slot: "C" },
      isEditable: false,
      injuryCode: undefined,
      injuryDetail: undefined,
      byeWeek: null,
      scheduled: true,
      startingLineup: "unconfirmed",
      undroppable: false,
      transactionTrend: {
        status: "not_published",
        reason: "Synthetic absence.",
      },
    },
    {
      providerPlayerKey: "465.p.90002",
      name: "Movable Bench",
      displayPosition: "C",
      primaryPosition: "C",
      positionType: "P",
      proTeamAbbreviation: undefined,
      eligiblePositions: ["C"],
      slot: { status: "verified", slot: "BN" },
      isEditable: true,
      injuryCode: undefined,
      injuryDetail: undefined,
      byeWeek: null,
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

const hockeyNativeAfter: ProviderRoster = {
  ...hockeyRoster,
  players: hockeyRoster.players.map((player, index) => ({
    ...player,
    slot: { status: "verified", slot: index === 0 ? "BN" : "C" },
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
  Layer.provide(ProviderFakeTest),
  Layer.provide(EncryptionTestLayer),
);
const TeamRepositoryTest = TeamRepository.layer.pipe(Layer.provide(DatabaseLayer));
const TeamsTest = TeamsLive.pipe(
  Layer.provide(TeamRepositoryTest),
  Layer.provide(LineupRepositoryTest),
  Layer.provide(ConnectionsTest),
);
const RetentionTest = RetentionSweepLive.pipe(
  Layer.provide(DatabaseLayer),
  Layer.provide(
    Layer.succeed(AccountRetention)({
      run: () => Effect.succeed({ sessions: 0, verifications: 0, consents: 0, registrations: 0 }),
    }),
  ),
);
const CredentialRepositoryTest = ConnectionCredentialRepository.layer.pipe(
  Layer.provide(DatabaseLayer),
);
const CredentialCensusTest = CredentialKeyCensusLive.pipe(
  Layer.provide(CredentialRepositoryTest),
  Layer.provide(EncryptionTestLayer),
);
const AutomationTest = AutomationLive.pipe(
  Layer.provide(TeamRepositoryTest),
  Layer.provide(LineupRepositoryTest),
  Layer.provide(DispatcherTest),
  Layer.provide(RetentionTest),
  Layer.provide(CredentialCensusTest),
);
const AutomationTestLayer = Layer.mergeAll(
  AutomationTest,
  TeamsTest,
  TeamRepositoryTest,
  RunsTest,
  ConnectionsTest,
  RetentionTest,
  LineupRepositoryTest,
).pipe(
  Layer.provideMerge(DatabaseLayer),
  Layer.provideMerge(ProviderFakeTest),
  Layer.provide(EncryptionTestLayer),
  Layer.provide(NodeCrypto.layer),
  Layer.orDie,
);
