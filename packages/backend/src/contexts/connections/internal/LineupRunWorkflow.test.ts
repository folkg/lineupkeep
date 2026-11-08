import { assert, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Schema, SchemaParser } from "effect";

import { decodeTeamId } from "#contexts/connections/FantasyTeam.ts";
import { LineupId } from "#contexts/connections/LineupRun.ts";
import { plan as planTransition, snapshotOf } from "#utilities/machine.ts";
import * as MachineTest from "#utilities/machineTest.ts";

import { LineupRunState, LineupRunWorkflow } from "./LineupRunWorkflow.ts";
import type { LineupRunEvent } from "./LineupRunWorkflow.ts";

const define = MachineTest.invariants(LineupRunWorkflow);
const invariants = [
  define.state(
    "only write-capable states own a write intent",
    ({ snapshot }) =>
      !("writeIntent" in snapshot.state.value) ||
      ["Applying", "Verifying", "RetryWait", "Uncertain"].includes(snapshot.state.path),
  ),
  define.state(
    "only Verifying owns a provider response",
    ({ snapshot }) =>
      "providerResponse" in snapshot.state.value === (snapshot.state.path === "Verifying"),
  ),
  define.state(
    "terminal runs own a verified outcome",
    ({ snapshot }) =>
      ["Completed", "Skipped", "Blocked", "Failed", "Uncertain", "Superseded"].includes(
        snapshot.state.path,
      ) ===
      "outcome" in snapshot.state.value,
  ),
];

it.effect("explores every lineup run transition and branch", () =>
  Effect.gen(function* () {
    const explored = yield* MachineTest.explore(LineupRunWorkflow, {
      input,
      events: () => events,
      stateKey: ({ snapshot }) => snapshot.state.path,
      invariants,
    });

    assert.strictEqual(explored.completeness._tag, "Complete");
    assert.strictEqual(explored.transitionCoverage.definitions.missing, 0);
    assert.strictEqual(explored.transitionCoverage.branches.missing, 0);
  }),
);

it.effect("resumes a retry wait stored before the machine changed library", () =>
  Effect.gen(function* () {
    const state = yield* SchemaParser.decodeEffect(Schema.toCodecJson(LineupRunState))(
      storedRetryWait,
    );
    const snapshot = yield* snapshotOf(LineupRunWorkflow, state);
    const next = yield* planTransition(LineupRunWorkflow, snapshot, retryClaimed);

    assert.strictEqual(next._tag, "Reading");
    if (next._tag !== "Reading") {
      return;
    }
    assert.strictEqual(next.attempt, 3);
    assert.deepStrictEqual(next.lease, retryLease);
    assert.isTrue(DateTime.Equivalence(next.startedAt, retryClaimed.at));
    assert.isTrue(DateTime.Equivalence(next.updatedAt, retryClaimed.at));
  }),
);

it.effect("reaches completed without replaying a write after a lost response", () =>
  Effect.gen(function* () {
    const trace = yield* MachineTest.run(LineupRunWorkflow, {
      input,
      events: [
        claimed,
        observation,
        plan,
        applyStarted,
        applyRespondedUnknown,
        verificationResumed,
        verified,
      ],
    });

    yield* MachineTest.verify(LineupRunWorkflow, trace);
  }),
);

it.effect("generates event sequences without violating run invariants", () =>
  Effect.gen(function* () {
    const generated = MachineTest.scenarios(LineupRunWorkflow, {
      inputArbitrary: Arbitrary.schema(Schema.Literal("queued")).pipe(Arbitrary.map(() => input)),
      eventsArbitrary: Arbitrary.array(
        Arbitrary.schema(
          Schema.Literals([
            "Claimed",
            "Reclaimed",
            "RetryClaimed",
            "VerificationClaimed",
            "ObservationRecorded",
            "PlanPrepared",
            "ApplyStarted",
            "ApplyResponded",
            "VerificationResumed",
            "ReconciliationStarted",
            "RetryScheduled",
            "Verified",
            "Blocked",
            "Skipped",
            "Failed",
            "Superseded",
            "Uncertain",
          ]),
        ).pipe(Arbitrary.map(eventFor)),
        { maxLength: 40 },
      ),
    });
    const result = yield* Arbitrary.checkEffect(
      generated.arbitrary,
      (scenario) =>
        Effect.gen(function* () {
          const trace = yield* MachineTest.run(LineupRunWorkflow, scenario);
          yield* MachineTest.verify(LineupRunWorkflow, trace);
          yield* MachineTest.checkInvariants(LineupRunWorkflow, trace, invariants);
          return true;
        }),
      { seed: 20261025, runs: 50 },
    );

    assert.strictEqual(result._tag, "Passed", Arbitrary.formatCheckFailure(result));
  }),
);

function eventFor(kind: (typeof eventKinds)[number]): LineupRunEvent {
  switch (kind) {
    case "Claimed":
      return claimed;
    case "Reclaimed":
      return { ...claimed, _tag: "Reclaimed" as const, attempt: 2 };
    case "RetryClaimed":
      return { ...claimed, _tag: "RetryClaimed" as const };
    case "VerificationClaimed":
      return { ...claimed, _tag: "VerificationClaimed" as const };
    case "ObservationRecorded":
      return observation;
    case "PlanPrepared":
      return plan;
    case "ApplyStarted":
      return applyStarted;
    case "ApplyResponded":
      return applyRespondedUnknown;
    case "VerificationResumed":
      return verificationResumed;
    case "ReconciliationStarted":
      return { ...verificationResumed, _tag: "ReconciliationStarted" as const };
    case "RetryScheduled":
      return retry;
    case "Verified":
      return verified;
    case "Blocked":
      return {
        _tag: "Blocked" as const,
        at,
        outcome: { ...outcome, kind: "blocked" as const, verified: false },
      };
    case "Skipped":
      return {
        _tag: "Skipped" as const,
        at,
        outcome: { ...outcome, kind: "skipped" as const, verified: false },
      };
    case "Failed":
      return {
        _tag: "Failed" as const,
        at,
        outcome: { ...outcome, kind: "failed" as const, verified: false },
      };
    case "Superseded":
      return {
        _tag: "Superseded" as const,
        at,
        outcome: { ...outcome, kind: "superseded" as const, verified: false },
      };
    case "Uncertain":
      return {
        _tag: "Uncertain" as const,
        at,
        outcome: { ...outcome, kind: "uncertain" as const, verified: false },
      };
  }
}

const eventKinds = [
  "Claimed",
  "Reclaimed",
  "RetryClaimed",
  "VerificationClaimed",
  "ObservationRecorded",
  "PlanPrepared",
  "ApplyStarted",
  "ApplyResponded",
  "VerificationResumed",
  "ReconciliationStarted",
  "RetryScheduled",
  "Verified",
  "Blocked",
  "Skipped",
  "Failed",
  "Superseded",
  "Uncertain",
] as const;

const team = decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2");
const target = { coverage: "week" as const, week: 3 };
const at = DateTime.makeUnsafe("2026-10-25T12:00:00Z");
const retryAt = DateTime.makeUnsafe("2026-10-25T12:00:30Z");
const lease = {
  token: Schema.decodeSync(LineupId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164b1"),
  generation: 1,
};
const writeIntent = {
  id: Schema.decodeSync(LineupId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164b2"),
  attempt: 1,
};
const observation = {
  _tag: "ObservationRecorded" as const,
  at,
  observation: {
    target,
    players: [
      {
        key: "461.p.10001",
        name: "Locked Starter",
        slot: { status: "verified" as const, slot: "QB" },
        editable: false,
        scheduled: true,
        startingLineup: "confirmed-starting" as const,
      },
      {
        key: "461.p.10002",
        name: "Movable Bench",
        slot: { status: "verified" as const, slot: "BN" },
        editable: true,
        scheduled: false,
        startingLineup: "unconfirmed" as const,
      },
    ],
    lockedPlayers: 1,
    editablePlayers: 1,
  },
};
const plan = {
  _tag: "PlanPrepared" as const,
  at,
  plan: {
    _tag: "native_action" as const,
    target,
    connectionGeneration: 1,
    lockedPlayers: 1,
    editablePlayers: 1,
  },
};
const claimed = { _tag: "Claimed" as const, at, lease, attempt: 1 };
const applyStarted = {
  _tag: "ApplyStarted" as const,
  at,
  writeIntent,
};
const applyRespondedUnknown = {
  _tag: "ApplyResponded" as const,
  at,
  providerResponse: "unknown" as const,
};
const verificationResumed = {
  _tag: "VerificationResumed" as const,
  at,
  lease,
  attempt: 2,
};
const outcome = {
  kind: "changed" as const,
  verified: true,
  reconciled: true,
  summary: "Verified a native lineup change after a lost response.",
  observedAt: at,
  changes: [{ name: "Movable Bench", from: "BN", to: "QB" }],
  lockedPlayers: 1,
  editablePlayers: 1,
};
const verified = { _tag: "Verified" as const, at, outcome };
const retryLease = {
  token: Schema.decodeSync(LineupId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164b3"),
  generation: 2,
};
const retryClaimed = {
  _tag: "RetryClaimed" as const,
  at: DateTime.makeUnsafe("2026-10-25T12:01:00Z"),
  lease: retryLease,
  attempt: 3,
};
const storedRetryWait = {
  _tag: "RetryWait",
  team: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2",
  target: { coverage: "week", week: 3 },
  trigger: "manual",
  implementation: "provider_native",
  implementationVersion: "provider-native/1",
  updatedAt: "2026-10-25T12:00:00.000Z",
  attempt: 2,
  reason: "provider_unavailable",
  detail: "The provider was unavailable.",
  retryAt: "2026-10-25T12:00:30.000Z",
  writeIntent: {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9164b2",
    attempt: 1,
  },
};
const retry = {
  _tag: "RetryScheduled" as const,
  at,
  attempt: 1,
  reason: "provider_unavailable",
  detail: "The provider was unavailable.",
  retryAt,
  writeIntent,
};
const events = eventKinds.map(eventFor);
const input = {
  _tag: "Queued" as const,
  team,
  target,
  trigger: "manual" as const,
  implementation: "provider_native" as const,
  implementationVersion: "provider-native/1",
  queuedAt: at,
  updatedAt: at,
};
