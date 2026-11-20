import { assert, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Schema, SchemaParser } from "effect";

import { decodeUserId } from "#contexts/auth/User.ts";
import { plan, snapshotOf } from "#utilities/machine.ts";
import * as MachineTest from "#utilities/machineTest.ts";

import {
  ConnectionNotificationEvent,
  ConnectionNotificationState,
  ConnectionNotificationWorkflow,
  initialConnectionNotificationState,
} from "./ConnectionNotificationWorkflow.ts";
import { notifications, NotificationsRow } from "./IncidentTables.ts";

const at = DateTime.makeUnsafe("2026-10-25T12:00:00Z");
const later = DateTime.makeUnsafe("2026-10-25T12:01:00Z");
const events: ReadonlyArray<ConnectionNotificationEvent> = [
  { _tag: "Claimed", at: later },
  { _tag: "Reclaimed", at: later },
  { _tag: "Sent", at: later },
  { _tag: "Cancelled", at: later },
  { _tag: "Undeliverable", at: later, error: "missing email" },
  { _tag: "Rejected", at: later, error: "rejected" },
  { _tag: "Retried", at: later, nextAttemptAt: later, error: "unavailable" },
];
const define = MachineTest.invariants(ConnectionNotificationWorkflow);
const invariants = [
  define.state(
    "only sent notifications have a sent timestamp",
    ({ snapshot }) => (snapshot.state.value.sentAt !== null) === (snapshot.state.path === "sent"),
  ),
  define.step("attempts advance only after an attempted delivery", ({ before, after, event }) => {
    const increment =
      before.state.path === "sending" &&
      (event._tag === "Sent" || event._tag === "Rejected" || event._tag === "Retried");
    return after.state.value.attempts === before.state.value.attempts + (increment ? 1 : 0);
  }),
];

it.effect("explores every notification state and transition, including terminal rejection", () =>
  Effect.gen(function* () {
    const explored = yield* MachineTest.explore(ConnectionNotificationWorkflow, {
      input: initialConnectionNotificationState(at),
      events: () => events,
      stateKey: ({ snapshot }) => `${snapshot.state.path}:${snapshot.state.value.attempts > 1}`,
      invariants,
    });
    assert.strictEqual(explored.completeness._tag, "Complete");
    assert.strictEqual(explored.transitionCoverage.definitions.missing, 0);
    assert.strictEqual(explored.transitionCoverage.branches.missing, 0);
    const statuses = ["pending", "sending", "sent", "cancelled", "failed"];
    assert.deepStrictEqual(
      [...new Set(explored.nodes.map(({ snapshot }) => snapshot.state.path))].sort(),
      statuses.toSorted(),
    );
    assert.deepStrictEqual(notifications.status.enumValues.toSorted(), statuses.toSorted());
    for (const node of explored.nodes.filter(({ snapshot }) =>
      ["sent", "cancelled", "failed"].includes(snapshot.state.path),
    )) {
      const trace = yield* MachineTest.run(ConnectionNotificationWorkflow, {
        input: node.snapshot.state.value,
        events,
      });
      assert.isTrue(trace.steps.every((step) => !step.accepted));
    }
  }),
);

it.effect("generates notification event sequences and checks invariants", () =>
  Effect.gen(function* () {
    const generated = MachineTest.scenarios(ConnectionNotificationWorkflow, {
      inputArbitrary: Arbitrary.schema(Schema.Literal("pending")).pipe(
        Arbitrary.map(() => initialConnectionNotificationState(at)),
      ),
      eventsArbitrary: Arbitrary.array(Arbitrary.schema(ConnectionNotificationEvent), {
        maxLength: 40,
      }),
    });
    const result = yield* Arbitrary.checkEffect(
      generated.arbitrary,
      (scenario) =>
        Effect.gen(function* () {
          const trace = yield* MachineTest.run(ConnectionNotificationWorkflow, scenario);
          yield* MachineTest.verify(ConnectionNotificationWorkflow, trace);
          yield* MachineTest.checkInvariants(ConnectionNotificationWorkflow, trace, invariants);
          return true;
        }),
      { seed: 20261120, runs: 100 },
    );
    assert.strictEqual(result._tag, "Passed", Arbitrary.formatCheckFailure(result));
  }),
);

it.effect("round-trips every state and row, then resumes a stored notification", () =>
  Effect.gen(function* () {
    const pending: Extract<ConnectionNotificationState, { readonly _tag: "pending" }> = {
      _tag: "pending",
      attempts: 0,
      nextAttemptAt: at,
      lastError: null,
      sentAt: null,
      updatedAt: at,
    };
    const sending: ConnectionNotificationState = {
      ...pending,
      _tag: "sending",
      attempts: 2,
      lastError: "retry",
    };
    const states: ReadonlyArray<ConnectionNotificationState> = [
      pending,
      sending,
      { ...sending, _tag: "sent", attempts: 3, lastError: null, sentAt: later, updatedAt: later },
      { ...pending, _tag: "cancelled", updatedAt: later },
      { ...sending, _tag: "failed", lastError: "rejected", updatedAt: later },
    ];
    for (const state of states) {
      const encoded = yield* SchemaParser.encodeEffect(
        Schema.toCodecJson(ConnectionNotificationState),
      )(state);
      const restored = yield* SchemaParser.decodeEffect(
        Schema.toCodecJson(ConnectionNotificationState),
      )(encoded);
      assert.isTrue(Schema.toEquivalence(ConnectionNotificationState)(restored, state));
      assert.strictEqual(restored._tag, state._tag);
      const row = {
        id: "notification-id",
        userId: decodeUserId("notification-owner"),
        incidentId: "incident-id",
        kind: "connection_reconnect_required" as const,
        createdAt: at,
        state,
      };
      const stored = yield* Schema.encodeEffect(NotificationsRow)(row);
      const decoded = yield* Schema.decodeEffect(NotificationsRow)(stored);
      assert.isTrue(Schema.toEquivalence(ConnectionNotificationState)(decoded.state, state));
      assert.strictEqual(decoded.state._tag, stored.status);
      const repeated = yield* Schema.encodeEffect(NotificationsRow)(decoded);
      assert.isTrue(Schema.toEquivalence(Schema.toEncoded(NotificationsRow))(repeated, stored));
    }
    const invalid = yield* Schema.encodeEffect(NotificationsRow)({
      id: "notification-id",
      userId: decodeUserId("notification-owner"),
      incidentId: "incident-id",
      kind: "connection_reconnect_required",
      createdAt: at,
      state: pending,
    });
    const rejected = yield* Effect.result(
      Schema.decodeEffect(NotificationsRow)({ ...invalid, status: "sent" }),
    );
    assert.strictEqual(rejected._tag, "Failure");
    const stored = yield* SchemaParser.decodeEffect(
      Schema.toCodecJson(ConnectionNotificationState),
    )({
      _tag: "sending",
      attempts: 2,
      nextAttemptAt: "2026-10-25T12:00:00.000Z",
      lastError: "retry",
      sentAt: null,
      updatedAt: "2026-10-25T12:00:00.000Z",
    });
    const next = yield* plan(
      ConnectionNotificationWorkflow,
      yield* snapshotOf(ConnectionNotificationWorkflow, stored),
      { _tag: "Retried", at: later, nextAttemptAt: later, error: "unavailable" },
    );
    assert.strictEqual(next._tag, "pending");
    assert.strictEqual(next.attempts, 3);
    assert.strictEqual(next.lastError, "unavailable");
  }),
);
