import { assert, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { decodeConnectionId } from "#contexts/connections/Connection.ts";
import {
  HostedLinkingFailureReason,
  HostedLinkingSessionId,
} from "#contexts/connections/HostedLinking.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";
import { snapshotOf } from "#utilities/machine.ts";
import * as MachineTest from "#utilities/machineTest.ts";

import { HostedLinkingRow } from "./HostedLinkingTables.ts";
import { HostedLinkingEvents, HostedLinkingWorkflow } from "./HostedLinkingWorkflow.ts";

const define = MachineTest.invariants(HostedLinkingWorkflow);
const invariants = [
  define.state(
    "only Completed owns completedAt",
    ({ snapshot }) =>
      "completedAt" in snapshot.state.value === (snapshot.state.path === "Completed"),
  ),
  define.state("Completed owns connectionId and other terminal states do not", ({ snapshot }) => {
    const state = snapshot.state.value;
    return state._tag === "Completed"
      ? "connectionId" in state
      : state._tag === "Active" || state._tag === "Completing" || !("connectionId" in state);
  }),
  define.state(
    "only Cancelled owns cancelledAt",
    ({ snapshot }) =>
      "cancelledAt" in snapshot.state.value === (snapshot.state.path === "Cancelled"),
  ),
  define.state(
    "only Expired owns expiredAt",
    ({ snapshot }) => "expiredAt" in snapshot.state.value === (snapshot.state.path === "Expired"),
  ),
  define.state(
    "only Failed owns failedAt and reason",
    ({ snapshot }) =>
      "failedAt" in snapshot.state.value === (snapshot.state.path === "Failed") &&
      "reason" in snapshot.state.value === (snapshot.state.path === "Failed"),
  ),
  define.state("terminal states own exactly their outcome fields", ({ snapshot }) => {
    const fields = [
      "completedAt",
      "connectionId",
      "cancelledAt",
      "expiredAt",
      "failedAt",
      "reason",
    ].filter((field) => field in snapshot.state.value);
    switch (snapshot.state.path) {
      case "Completed":
        return fields.join(",") === "completedAt,connectionId";
      case "Cancelled":
        return fields.join(",") === "cancelledAt";
      case "Expired":
        return fields.join(",") === "expiredAt";
      case "Failed":
        return fields.join(",") === "failedAt,reason";
      default:
        return true;
    }
  }),
];

it.effect("round-trips every hosted linking lifecycle state through its row codec", () =>
  Effect.gen(function* () {
    const explored = yield* MachineTest.explore(HostedLinkingWorkflow, {
      input,
      events: () => events,
      stateKey: ({ snapshot }) => JSON.stringify(snapshot),
      invariants,
    });
    assert.strictEqual(explored.completeness._tag, "Complete");
    assert.strictEqual(explored.transitionCoverage.definitions.missing, 0);

    for (const { snapshot } of explored.nodes) {
      const record = {
        id: sessionId,
        userId: owner,
        ticketHash: "ticket-hash",
        createdAt: at,
        state: snapshot.state.value,
      };
      const row = yield* Schema.encodeEffect(HostedLinkingRow)(record);
      const decoded = yield* Schema.decodeEffect(HostedLinkingRow)(row);
      const restored = yield* snapshotOf(HostedLinkingWorkflow, decoded.state);

      assert.deepStrictEqual(restored.state, snapshot.state.value);
      assert.deepStrictEqual(yield* Schema.encodeEffect(HostedLinkingRow)(decoded), row);
      assert.strictEqual(decoded.id, record.id);
      assert.strictEqual(decoded.userId, record.userId);
      assert.strictEqual(decoded.ticketHash, record.ticketHash);
      assert.deepStrictEqual(decoded.createdAt, record.createdAt);
    }
  }),
);

it.effect("round-trips a reconnect target through the row codec", () =>
  Effect.gen(function* () {
    const record = {
      id: sessionId,
      userId: owner,
      ticketHash: "ticket-hash",
      createdAt: at,
      state: {
        _tag: "Active" as const,
        provider: decodeProviderKey("yahoo"),
        startedAt: at,
        expiresAt: DateTime.addDuration(at, "10 minutes"),
        connectionId,
        updatedAt: at,
      },
    };

    const row = yield* Schema.encodeEffect(HostedLinkingRow)(record);
    const decoded = yield* Schema.decodeEffect(HostedLinkingRow)(row);

    assert.strictEqual(decoded.state._tag, "Active");
    assert.strictEqual(
      decoded.state._tag === "Active" ? decoded.state.connectionId : undefined,
      connectionId,
    );
    assert.deepStrictEqual(yield* Schema.encodeEffect(HostedLinkingRow)(decoded), row);
  }),
);

it.effect("checks generated event sequences against the hosted linking machine", () =>
  Effect.gen(function* () {
    const values = Arbitrary.schema(
      Schema.Struct({
        millis: Schema.Int.check(
          Schema.isBetween({ minimum: -8_640_000_000_000_000, maximum: 8_640_000_000_000_000 }),
        ),
        kind: Schema.Literals([
          "CompletionStarted",
          "CompletionSucceeded",
          "CompletionFailed",
          "Cancelled",
          "Expired",
        ]),
        reason: HostedLinkingFailureReason,
      }),
    ).pipe(
      Arbitrary.map(({ millis, kind, reason }) => ({
        at: DateTime.makeUnsafe(millis),
        kind,
        reason,
      })),
    );
    const generated = MachineTest.scenarios(HostedLinkingWorkflow, {
      inputArbitrary: values.pipe(
        Arbitrary.map(({ at }) => ({
          _tag: "Active" as const,
          provider: decodeProviderKey("yahoo"),
          startedAt: at,
          expiresAt: at,
          updatedAt: at,
        })),
      ),
      eventsArbitrary: Arbitrary.array(
        values.pipe(
          Arbitrary.map(({ at, kind, reason }) => {
            switch (kind) {
              case "CompletionStarted":
                return { _tag: kind, at };
              case "CompletionSucceeded":
                return { _tag: kind, at, connectionId };
              case "CompletionFailed":
                return { _tag: kind, at, reason };
              case "Cancelled":
              case "Expired":
                return { _tag: kind, at };
            }
          }),
        ),
        { maxLength: 50 },
      ),
    });
    const result = yield* Arbitrary.checkEffect(
      generated.arbitrary,
      (scenario) =>
        Effect.gen(function* () {
          const trace = yield* MachineTest.run(HostedLinkingWorkflow, scenario);
          yield* MachineTest.verify(HostedLinkingWorkflow, trace);
          yield* MachineTest.checkInvariants(HostedLinkingWorkflow, trace, invariants);
          return true;
        }),
      { seed: 20261025, runs: 100 },
    );

    assert.strictEqual(result._tag, "Passed", Arbitrary.formatCheckFailure(result));
  }),
);

const at = DateTime.makeUnsafe("2026-10-25T12:00:00.000Z");
const sessionId = Schema.decodeSync(HostedLinkingSessionId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2");
const owner = Schema.decodeSync(UserId)("owner");
const connectionId = decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a3");

const input = {
  _tag: "Active" as const,
  provider: decodeProviderKey("yahoo"),
  startedAt: at,
  expiresAt: DateTime.addDuration(at, "10 minutes"),
  updatedAt: at,
};

const events = [
  HostedLinkingEvents.cases.CompletionStarted.make({ at }),
  HostedLinkingEvents.cases.CompletionSucceeded.make({ at, connectionId }),
  HostedLinkingEvents.cases.CompletionFailed.make({
    at,
    reason: "session_rejected",
  }),
  HostedLinkingEvents.cases.Cancelled.make({ at }),
  HostedLinkingEvents.cases.Expired.make({ at }),
];
