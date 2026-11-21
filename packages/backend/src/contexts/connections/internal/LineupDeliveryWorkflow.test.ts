import { assert, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Schema, SchemaParser } from "effect";
import { Array as EffectArray } from "effect";
import { Option as EffectOption, Order as EffectOrder } from "effect";

import { plan, snapshotOf } from "#utilities/machine.ts";
import * as MachineTest from "#utilities/machineTest.ts";

import {
  initialLineupDeliveryState,
  lineupDeliveryStatus,
  LineupDeliveryEvent,
  LineupDeliveryState,
  LineupDeliveryWorkflow,
} from "./LineupDeliveryWorkflow.ts";
import { lineupDeliveries } from "./LineupRunTables.ts";

const at = DateTime.makeUnsafe("2026-10-25T12:00:00Z");
const later = DateTime.makeUnsafe("2026-10-25T12:01:00Z");
const events: ReadonlyArray<LineupDeliveryEvent> = [
  { _tag: "Claimed", at: later },
  { _tag: "Dispatched", at: later },
  { _tag: "Released", at: later },
  { _tag: "Released", at: later, error: "provider_unavailable" },
];
const define = MachineTest.invariants(LineupDeliveryWorkflow);
const invariants = [
  define.state(
    "only dispatched deliveries have a timestamp",
    ({ snapshot }) =>
      (snapshot.state.value.dispatchedAt !== null) === (snapshot.state.path === "dispatched"),
  ),
  define.step(
    "claim increments attempts; other transitions preserve them",
    ({ before, after, event }) =>
      after.state.value.attempts ===
      before.state.value.attempts +
        (event._tag === "Claimed" && before.state.path !== "dispatched" ? 1 : 0),
  ),
];

it.effect("explores every delivery state and transition, including terminal rejection", () =>
  Effect.gen(function* () {
    const explored = yield* MachineTest.explore(LineupDeliveryWorkflow, {
      input: initialLineupDeliveryState(at),
      events: () => events,
      stateKey: ({ snapshot }) => `${snapshot.state.path}:${snapshot.state.value.attempts > 1}`,
      invariants,
    });
    assert.strictEqual(explored.completeness._tag, "Complete");
    assert.strictEqual(explored.transitionCoverage.definitions.missing, 0);
    assert.strictEqual(explored.transitionCoverage.branches.missing, 0);
    const states = ["dispatched", "dispatching", "pending"];
    assert.deepStrictEqual(
      EffectArray.sort(
        [...new Set(EffectArray.map(explored.nodes, ({ snapshot }) => snapshot.state.path))],
        EffectOrder.String,
      ),
      states,
    );
    assert.deepStrictEqual(
      EffectArray.sort(lineupDeliveries.status.enumValues, EffectOrder.String),
      states,
    );
    const final = EffectOption.getOrUndefined(
      EffectArray.findFirst(explored.nodes, ({ snapshot }) => snapshot.state.path === "dispatched"),
    );
    assert.isDefined(final);
    const trace = yield* MachineTest.run(LineupDeliveryWorkflow, {
      input: final.snapshot.state.value,
      events,
    });
    assert.isTrue(EffectArray.every(trace.steps, (step) => !step.accepted));
  }),
);

it.effect("generates event sequences and checks invariants", () =>
  Effect.gen(function* () {
    const generated = MachineTest.scenarios(LineupDeliveryWorkflow, {
      inputArbitrary: Arbitrary.schema(Schema.Literal("pending")).pipe(
        Arbitrary.map(() => initialLineupDeliveryState(at)),
      ),
      eventsArbitrary: Arbitrary.array(Arbitrary.schema(LineupDeliveryEvent), { maxLength: 40 }),
    });
    const result = yield* Arbitrary.checkEffect(
      generated.arbitrary,
      (scenario) =>
        Effect.gen(function* () {
          const trace = yield* MachineTest.run(LineupDeliveryWorkflow, scenario);
          yield* MachineTest.verify(LineupDeliveryWorkflow, trace);
          yield* MachineTest.checkInvariants(LineupDeliveryWorkflow, trace, invariants);
          return true;
        }),
      { seed: 20261120, runs: 100 },
    );
    assert.strictEqual(result._tag, "Passed", Arbitrary.formatCheckFailure(result));
  }),
);

it.effect("round-trips every state through JSON and resumes a stored delivery", () =>
  Effect.gen(function* () {
    const pending = initialLineupDeliveryState(at);
    const dispatching: LineupDeliveryState = {
      _tag: "dispatching",
      attempts: 2,
      lastError: "retry",
      dispatchedAt: null,
      updatedAt: at,
    };
    const dispatched: LineupDeliveryState = {
      _tag: "dispatched",
      attempts: 2,
      lastError: null,
      dispatchedAt: later,
      updatedAt: later,
    };
    for (const state of [pending, dispatching, dispatched]) {
      const encoded = yield* SchemaParser.encodeEffect(Schema.toCodecJson(LineupDeliveryState))(
        state,
      );
      const restored = yield* SchemaParser.decodeEffect(Schema.toCodecJson(LineupDeliveryState))(
        encoded,
      );
      assert.isTrue(Schema.toEquivalence(LineupDeliveryState)(restored, state));
      assert.strictEqual(lineupDeliveryStatus(restored), state._tag);
    }
    const stored = yield* SchemaParser.decodeEffect(Schema.toCodecJson(LineupDeliveryState))({
      _tag: "dispatching",
      attempts: 2,
      lastError: "retry",
      dispatchedAt: null,
      updatedAt: "2026-10-25T12:00:00.000Z",
    });
    const yielded1 = yield* snapshotOf(LineupDeliveryWorkflow, stored);
    const next = yield* plan(LineupDeliveryWorkflow, yielded1, {
      _tag: "Released",
      at: later,
    });
    assert.strictEqual(next._tag, "pending");
    assert.strictEqual(next.attempts, 2);
    assert.strictEqual(next.lastError, null);
  }),
);

it.effect("retains errors on claim, clears them on release without error or dispatch", () =>
  Effect.gen(function* () {
    const trace = yield* MachineTest.run(LineupDeliveryWorkflow, {
      input: initialLineupDeliveryState(at),
      events: [
        { _tag: "Claimed", at },
        { _tag: "Released", at: later, error: "provider_unavailable" },
        { _tag: "Claimed", at: later },
        { _tag: "Claimed", at: later },
        { _tag: "Released", at: later },
        { _tag: "Claimed", at: later },
        { _tag: "Dispatched", at: later },
      ],
    });
    assert.strictEqual(trace.steps[1]?.after.state.value.lastError, "provider_unavailable");
    assert.strictEqual(trace.steps[2]?.after.state.value.lastError, "provider_unavailable");
    assert.strictEqual(trace.steps[2]?.after.state.value.attempts, 2);
    assert.strictEqual(trace.steps[3]?.after.state.value.attempts, 3);
    assert.strictEqual(trace.steps[4]?.after.state.value.lastError, null);
    assert.strictEqual(trace.final.state.path, "dispatched");
    assert.strictEqual(trace.final.state.value.lastError, null);
    assert.isTrue(
      trace.final.state.value.dispatchedAt !== null &&
        DateTime.Equivalence(trace.final.state.value.dispatchedAt, later),
    );
  }),
);
