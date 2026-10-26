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
import { lineupRuns, lineupTeamLeases, lineupWriteIntents } from "./internal/LineupRunTables.ts";
import type { LineupRunRecord } from "./internal/LineupRunTables.ts";
import { LineupRunState } from "./internal/LineupRunWorkflow.ts";
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
    assert.strictEqual(submitted.runs[0]?.outcome?.implementation, "provider_native");
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

it.effect("applies and verifies changed explicit assignments", () =>
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const worker = yield* LineupWorker;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedCustom(fake);
    const runId = yield* createCustomRun(repository, team);

    yield* worker.deliver([runId]);

    const run = yield* loadRun(repository, runId);
    assert.strictEqual(run.status, "completed");
    assert.strictEqual(run.state._tag, "Completed");
    if (run.state._tag !== "Completed") {
      return;
    }
    assert.strictEqual(run.state.outcome.kind, "changed");
    assert.strictEqual(run.state.outcome.verified, true);
    assert.strictEqual(run.state.outcome.reconciled, false);
    assert.strictEqual(run.state.outcome.implementation, "custom_policy");
    assert.strictEqual(run.state.outcome.policy?.kind, "planned");
    assert.strictEqual(run.state.outcome.changes.length, 2);
    assert.strictEqual(yield* fake.explicitCallCount, 1);
    assert.strictEqual(yield* fake.nativeCallCount, 0);
    const requests = yield* fake.explicitRequests;
    assert.strictEqual(requests[0]?.length, 2);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("reports exactly which explicit assignments differed after acceptance", () =>
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const worker = yield* LineupWorker;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedCustom(fake);
    yield* fake.setExplicitAfter(customRoster);
    const runId = yield* createCustomRun(repository, team);

    yield* worker.deliver([runId]);

    const run = yield* loadRun(repository, runId);
    assert.strictEqual(run.status, "failed");
    assert.strictEqual(run.state._tag, "Failed");
    if (run.state._tag !== "Failed") {
      return;
    }
    assert.strictEqual(run.state.outcome.kind, "failed");
    assert.strictEqual(run.state.outcome.verified, true);
    assert.strictEqual(run.state.outcome.differences?.length, 2);
    assert.strictEqual(run.state.outcome.implementation, "custom_policy");
    assert.strictEqual(yield* fake.explicitCallCount, 1);
    yield* worker.deliver([runId]);
    assert.strictEqual(yield* fake.explicitCallCount, 1);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("reports unplanned readback changes as a mismatch after acceptance", () =>
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const worker = yield* LineupWorker;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedCustom(fake);
    yield* fake.setExplicitAfter(explicitWithExtraEdit);
    const runId = yield* createCustomRun(repository, team);

    yield* worker.deliver([runId]);

    const run = yield* loadRun(repository, runId);
    assert.strictEqual(run.status, "failed");
    assert.strictEqual(run.state._tag, "Failed");
    if (run.state._tag !== "Failed") {
      return;
    }
    assert.strictEqual(run.state.outcome.kind, "failed");
    assert.strictEqual(run.state.outcome.verified, true);
    assert.strictEqual(run.state.outcome.differences?.length, 2);
    assert.deepStrictEqual(
      run.state.outcome.differences?.map((difference) => difference.expected),
      ["QB", "BN"],
    );
    assert.strictEqual(run.state.outcome.implementation, "custom_policy");
    assert.strictEqual(yield* fake.explicitCallCount, 1);
    yield* worker.deliver([runId]);
    assert.strictEqual(yield* fake.explicitCallCount, 1);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("fails an invalid explicit assignment request without retrying", () =>
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const worker = yield* LineupWorker;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedCustom(fake);
    yield* fake.setExplicitAction("invalid");
    const runId = yield* createCustomRun(repository, team);

    yield* worker.deliver([runId]);

    const run = yield* loadRun(repository, runId);
    assert.strictEqual(run.status, "failed");
    assert.strictEqual(run.state._tag, "Failed");
    if (run.state._tag !== "Failed") {
      return;
    }
    assert.strictEqual(run.state.outcome.kind, "failed");
    assert.strictEqual(run.state.outcome.verified, false);
    assert.strictEqual(run.state.outcome.implementation, "custom_policy");
    assert.strictEqual(run.state.outcome.policy?.kind, "planned");
    assert.strictEqual(yield* fake.explicitCallCount, 1);
    yield* worker.deliver([runId]);
    assert.strictEqual(yield* fake.explicitCallCount, 1);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("uses the recorded acceptance when verification resumes", () =>
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const worker = yield* LineupWorker;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedCustom(fake);
    const runId = yield* createCustomRun(repository, team);

    yield* worker.deliver([runId]);
    const completed = yield* loadRun(repository, runId);
    assert.strictEqual(completed.status, "completed");
    assert.strictEqual(completed.state._tag, "Completed");
    if (completed.state._tag !== "Completed") {
      return;
    }

    const database = yield* ConnectionsDatabase;
    const intents = yield* database
      .select({ id: lineupWriteIntents.id, attempt: lineupWriteIntents.attempt })
      .from(lineupWriteIntents)
      .where(eq(lineupWriteIntents.runId, runId))
      .limit(1);
    const intent = intents[0];
    assert.isDefined(intent);
    const state = yield* Schema.encodeEffect(Schema.toCodecJson(LineupRunState))({
      _tag: "Verifying",
      team: completed.state.team,
      target: completed.state.target,
      trigger: completed.state.trigger,
      implementation: completed.state.implementation,
      implementationVersion: completed.state.implementationVersion,
      updatedAt: completed.state.updatedAt,
      lease: { token: "018f79ea-7d86-4c18-9b4a-ffffffffffff", generation: 1 },
      attempt: completed.attempts,
      writeIntent: { id: intent.id, attempt: intent.attempt },
      providerResponse: "accepted",
    });
    yield* database
      .update(lineupRuns)
      .set({ state, status: "verifying" })
      .where(eq(lineupRuns.id, runId));
    yield* database
      .update(lineupTeamLeases)
      .set({ expiresAt: DateTime.toDateUtc(DateTime.makeUnsafe("1969-12-31T23:59:00Z")) })
      .where(eq(lineupTeamLeases.runId, runId));
    yield* database
      .update(lineupWriteIntents)
      .set({ status: "accepted" })
      .where(eq(lineupWriteIntents.id, intent.id));
    yield* fake.setRoster(customRoster);

    yield* worker.deliver([runId]);

    const resumed = yield* loadRun(repository, runId);
    assert.strictEqual(resumed.status, "failed");
    assert.strictEqual(resumed.state._tag, "Failed");
    if (resumed.state._tag !== "Failed") {
      return;
    }
    assert.strictEqual(resumed.state.outcome.verified, true);
    assert.strictEqual(resumed.state.outcome.differences?.length, 2);
    assert.strictEqual(yield* fake.explicitCallCount, 1);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("reconciles a lost explicit response when the readback matches the plan", () =>
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const worker = yield* LineupWorker;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedCustom(fake);
    yield* fake.setExplicitAction("lost_response");
    const runId = yield* createCustomRun(repository, team);

    yield* worker.deliver([runId]);

    const run = yield* loadRun(repository, runId);
    assert.strictEqual(run.status, "completed");
    assert.strictEqual(run.state._tag, "Completed");
    if (run.state._tag !== "Completed") {
      return;
    }
    assert.strictEqual(run.state.outcome.kind, "changed");
    assert.strictEqual(run.state.outcome.verified, true);
    assert.strictEqual(run.state.outcome.reconciled, true);
    assert.strictEqual(yield* fake.explicitCallCount, 1);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect(
  "keeps a lost explicit response uncertain when the lineup changed away from the plan",
  () =>
    Effect.gen(function* () {
      const repository = yield* LineupRunRepository;
      const worker = yield* LineupWorker;
      const fake = yield* FakeProviderWorld;
      const team = yield* seedCustom(fake);
      yield* fake.setExplicitAction("lost_response");
      yield* fake.setExplicitAfter(humanEditedRoster);
      const runId = yield* createCustomRun(repository, team);

      yield* worker.deliver([runId]);

      const run = yield* loadRun(repository, runId);
      assert.strictEqual(run.status, "uncertain");
      assert.strictEqual(run.state._tag, "Uncertain");
      if (run.state._tag !== "Uncertain") {
        return;
      }
      assert.strictEqual(run.state.outcome.kind, "uncertain");
      assert.strictEqual(run.state.outcome.differences?.length, 4);
      assert.strictEqual(yield* fake.explicitCallCount, 1);
      yield* worker.deliver([runId]);
      assert.strictEqual(yield* fake.explicitCallCount, 1);
    }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("retries a lost explicit response only when the readback is unchanged", () =>
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const worker = yield* LineupWorker;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedCustom(fake);
    yield* fake.setExplicitAction("lost_response");
    yield* fake.setExplicitAfter(customRoster);
    const runId = yield* createCustomRun(repository, team);

    yield* worker.deliver([runId]);

    const run = yield* loadRun(repository, runId);
    assert.strictEqual(run.status, "retry-wait");
    assert.strictEqual(run.state._tag, "RetryWait");
    if (run.state._tag !== "RetryWait") {
      return;
    }
    assert.strictEqual(run.state.reason, "provider_outcome_unknown");
    assert.strictEqual(yield* fake.explicitCallCount, 1);
    yield* worker.deliver([runId]);
    assert.strictEqual(yield* fake.explicitCallCount, 1);

    const database = yield* ConnectionsDatabase;
    const stored = yield* database
      .select({ state: lineupRuns.state })
      .from(lineupRuns)
      .where(eq(lineupRuns.id, runId))
      .limit(1);
    const row = stored[0];
    assert.isDefined(row);
    const retryWait = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(LineupRunState))(
      row.state,
    );
    if (retryWait._tag !== "RetryWait") {
      return;
    }
    const state = yield* Schema.encodeEffect(Schema.toCodecJson(LineupRunState))({
      ...retryWait,
      retryAt: DateTime.makeUnsafe("1969-12-31T23:59:00Z"),
    });
    yield* database.update(lineupRuns).set({ state }).where(eq(lineupRuns.id, runId));
    yield* database
      .update(lineupTeamLeases)
      .set({ expiresAt: DateTime.toDateUtc(DateTime.makeUnsafe("1969-12-31T23:59:00Z")) })
      .where(eq(lineupTeamLeases.runId, runId));
    yield* fake.setExplicitAction("accept");
    yield* fake.setExplicitAfter(undefined);

    yield* worker.deliver([runId]);

    assert.strictEqual(yield* fake.explicitCallCount, 2);
    const retried = yield* loadRun(repository, runId);
    assert.strictEqual(retried.status, "completed");
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("falls back to the native action when the custom policy cannot score a league", () =>
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const worker = yield* LineupWorker;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedOne(fake, teamFixture("461.l.1000.t.1", "Alpha"));
    const runId = yield* createCustomRun(repository, team);

    yield* worker.deliver([runId]);

    const run = yield* loadRun(repository, runId);
    assert.strictEqual(run.status, "completed");
    assert.strictEqual(run.state._tag, "Completed");
    if (run.state._tag !== "Completed") {
      return;
    }
    assert.strictEqual(run.state.outcome.kind, "changed");
    assert.strictEqual(run.state.outcome.implementation, "provider_native");
    assert.strictEqual(run.state.outcome.policy?.kind, "refused");
    assert.strictEqual(yield* fake.nativeCallCount, 1);
    assert.strictEqual(yield* fake.explicitCallCount, 0);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("replans from a fresh read instead of writing a stale explicit plan", () =>
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const worker = yield* LineupWorker;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedCustom(fake);
    yield* fake.setRosterAfterNextRead(humanEditedRoster);
    const runId = yield* createCustomRun(repository, team);

    yield* worker.deliver([runId]);

    const run = yield* loadRun(repository, runId);
    assert.strictEqual(run.status, "completed");
    assert.strictEqual(run.state._tag, "Completed");
    if (run.state._tag !== "Completed") {
      return;
    }
    assert.strictEqual(run.state.outcome.implementation, "custom_policy");
    assert.strictEqual(run.state.outcome.policy?.kind, "planned");
    assert.include(run.state.outcome.summary, "roster changed before the write");
    const requests = yield* fake.explicitRequests;
    assert.strictEqual(requests[0]?.length, 4);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("blocks an explicit write when the roster membership changed", () =>
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const worker = yield* LineupWorker;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedCustom(fake);
    yield* fake.setRosterAfterNextRead({
      ...customRoster,
      players: [...customRoster.players, customPlayer("461.p.20005", "TE One", "TE", "BN")],
    });
    const runId = yield* createCustomRun(repository, team);

    yield* worker.deliver([runId]);

    const run = yield* loadRun(repository, runId);
    assert.strictEqual(run.status, "blocked");
    assert.strictEqual(yield* fake.explicitCallCount, 0);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("blocks an explicit write when the roster period changed", () =>
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const worker = yield* LineupWorker;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedCustom(fake);
    yield* fake.setRosterAfterNextRead({
      ...customRoster,
      coverage: { type: "week", week: 4 },
    });
    const runId = yield* createCustomRun(repository, team);

    yield* worker.deliver([runId]);

    const run = yield* loadRun(repository, runId);
    assert.strictEqual(run.status, "blocked");
    assert.strictEqual(yield* fake.explicitCallCount, 0);
  }).pipe(Effect.provide(LineupTestLayer)),
);

it.effect("blocks an explicit write when the scoring week changes during planning", () =>
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const worker = yield* LineupWorker;
    const fake = yield* FakeProviderWorld;
    const team = yield* seedCustom(fake);
    const gate = yield* fake.blockRosterRead;
    const runId = yield* createCustomRun(repository, team);

    const fiber = yield* Effect.forkChild(worker.deliver([runId]));
    yield* Deferred.await(gate.started);
    yield* fake.setLeague({
      ...customLeague,
      periodWindow: { currentWeek: 4, startWeek: 1, endWeek: 17 },
    });
    yield* Deferred.succeed(gate.release, undefined);
    yield* Fiber.join(fiber);

    const run = yield* loadRun(repository, runId);
    assert.strictEqual(run.status, "blocked");
    assert.strictEqual(yield* fake.explicitCallCount, 0);
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

function createCustomRun(
  repository: LineupRunRepository["Service"],
  team: { readonly id: import("./FantasyTeam.ts").TeamId; readonly connectionId: ConnectionId },
): Effect.Effect<import("./LineupRun.ts").LineupRunId> {
  return Effect.gen(function* () {
    const created = yield* repository.createRequest({
      userId: owner,
      requestId: testRequestId(),
      intent: "custom-policy",
      runs: [
        {
          team: team.id,
          connectionId: team.connectionId,
          target: { coverage: "week", week: 3 },
          trigger: "manual",
          implementation: "custom_policy",
        },
      ],
    });
    const runId = created.runs[0]?.id;
    if (runId === undefined) {
      return yield* Effect.die(new Error("The custom run was not created"));
    }
    return runId;
  }).pipe(Effect.orDie);
}

function loadRun(
  repository: LineupRunRepository["Service"],
  runId: import("./LineupRun.ts").LineupRunId,
): Effect.Effect<LineupRunRecord> {
  return repository.loadRuns(owner, { runs: [runId], limit: 1 }).pipe(
    Effect.map((loaded) => {
      const run = loaded.runs[0];
      if (run === undefined) {
        throw new Error("The created run could not be loaded");
      }
      return run;
    }),
    Effect.orDie,
  );
}

function seedCustom(
  fake: FakeProviderWorld["Service"],
): Effect.Effect<
  { readonly id: import("./FantasyTeam.ts").TeamId; readonly connectionId: ConnectionId },
  never,
  Connections
> {
  return Effect.gen(function* () {
    const team = yield* seedOne(fake, teamFixture("461.l.1000.t.1", "Alpha"));
    yield* fake.setLeague(customLeague);
    yield* fake.setRoster(customRoster);
    yield* fake.setPlayerDetails(customDetails);
    return team;
  });
}

function customPlayer(
  providerPlayerKey: string,
  name: string,
  position: string,
  slot: string,
): ProviderRoster["players"][number] {
  return {
    providerPlayerKey,
    name,
    displayPosition: position,
    primaryPosition: position,
    positionType: "O",
    proTeamAbbreviation: undefined,
    eligiblePositions: [position],
    slot,
    isFlex: null,
    isEditable: true,
    injuryCode: undefined,
    injuryDetail: undefined,
    byeWeek: null,
    undroppable: false,
  };
}

function customDetail(
  providerPlayerKey: string,
  name: string,
  position: string,
  value: number,
): import("./Provider.ts").ProviderPlayerDetail {
  return {
    providerPlayerKey,
    name,
    primaryPosition: position,
    displayPosition: position,
    eligiblePositions: undefined,
    rosterStatus: "rostered",
    actual: { basis: { type: "week", week: 2 }, stats: [{ statId: 4, value }] },
    projected: undefined,
  };
}

const customLeague: ProviderLeagueSettings = {
  providerLeagueKey: "461.l.1000",
  name: "Custom League",
  webUrl: "https://football.fantasysports.yahoo.com/f1/1000",
  season: 2026,
  periodWindow: { currentWeek: 3, startWeek: 1, endWeek: 17 },
  rosterCoverage: "week",
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
    { position: "RB", positionType: "O", count: 1, isStarting: true },
    { position: "BN", positionType: "B", count: 2, isStarting: false },
  ],
  statCategories: [
    {
      statId: 4,
      name: "Yards",
      displayName: "Yards",
      abbreviation: "Yds",
      group: "",
      enabled: true,
      positionTypes: [],
    },
  ],
  statModifiers: [{ statId: 4, points: "1" }],
};

const customRoster: ProviderRoster = {
  providerTeamKey: "461.l.1000.t.1",
  providerLeagueKey: "461.l.1000",
  coverage: { type: "week", week: 3 },
  players: [
    customPlayer("461.p.20001", "QB One", "QB", "QB"),
    customPlayer("461.p.20002", "RB One", "RB", "RB"),
    customPlayer("461.p.20003", "RB Two", "RB", "BN"),
    customPlayer("461.p.20004", "QB Two", "QB", "BN"),
  ],
};

const customDetails = [
  customDetail("461.p.20001", "QB One", "QB", 10),
  customDetail("461.p.20002", "RB One", "RB", 5),
  customDetail("461.p.20003", "RB Two", "RB", 15),
  customDetail("461.p.20004", "QB Two", "QB", 1),
];

const humanEditedRoster: ProviderRoster = {
  ...customRoster,
  players: [
    customPlayer("461.p.20001", "QB One", "QB", "BN"),
    customPlayer("461.p.20002", "RB One", "RB", "RB"),
    customPlayer("461.p.20003", "RB Two", "RB", "BN"),
    customPlayer("461.p.20004", "QB Two", "QB", "QB"),
  ],
};

const explicitWithExtraEdit: ProviderRoster = {
  ...customRoster,
  players: [
    customPlayer("461.p.20001", "QB One", "QB", "BN"),
    customPlayer("461.p.20002", "RB One", "RB", "BN"),
    customPlayer("461.p.20003", "RB Two", "RB", "RB"),
    customPlayer("461.p.20004", "QB Two", "QB", "QB"),
  ],
};

function testRequestId(): string {
  requestSerial += 1;
  return `018f79ea-7d86-4c18-9b4a-${String(requestSerial).padStart(12, "0")}`;
}

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
let requestSerial = 0;
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
  rosterCoverage: "week",
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
