import { assert, it } from "@effect/vitest";
import { Machine } from "@typeonce/effect-machine";
import { MachineTest } from "@typeonce/effect-machine/testing";
import { Arbitrary, DateTime, Effect, Schema } from "effect";

import {
  ConnectionLifecycleState,
  ConnectionLifecycleWorkflow,
} from "./ConnectionLifecycleWorkflow.ts";
import type { ConnectionLifecycleRequest } from "./ConnectionLifecycleWorkflow.ts";

const define = MachineTest.invariants(ConnectionLifecycleWorkflow);
const invariants = [
  define.state(
    "only Linking owns expiresAt",
    ({ snapshot }) => "expiresAt" in snapshot.state.value === (snapshot.state.path === "Linking"),
  ),
  define.state(
    "only Disconnected owns disconnectedAt",
    ({ snapshot }) =>
      "disconnectedAt" in snapshot.state.value === (snapshot.state.path === "Disconnected"),
  ),
  define.step(
    "an accepted cancellation timestamps the event",
    ({ before, after, event }) =>
      before.state.path === "Disconnected" ||
      (after.state.value._tag === "Disconnected" &&
        DateTime.Equivalence(after.state.value.disconnectedAt, event.at) &&
        DateTime.Equivalence(after.state.value.updatedAt, event.at)),
  ),
  define.state("Disconnected is terminal and accepts no event", ({ snapshot }) => {
    if (snapshot.state.path !== "Disconnected") {
      return true;
    }
    return [cancel].every((event: ConnectionLifecycleRequest) => {
      const planned = Effect.runSync(Machine.plan(ConnectionLifecycleWorkflow, snapshot, event));
      return (
        planned.microsteps.every((step) => step.transitions.length === 0) &&
        Schema.toEquivalence(ConnectionLifecycleState)(
          planned.next.state.value,
          snapshot.state.value,
        )
      );
    });
  }),
];

it.effect("explores every connection transition without retaining startup data", () =>
  Effect.gen(function* () {
    const explored = yield* MachineTest.explore(ConnectionLifecycleWorkflow, {
      input,
      events: () => [cancel],
      stateKey: ({ snapshot }) => snapshot.state.path,
      invariants,
    });

    assert.strictEqual(explored.completeness._tag, "Complete");
    assert.strictEqual(explored.transitionCoverage.definitions.missing, 0);
    assert.strictEqual(explored.transitionCoverage.branches.missing, 0);
  }),
);

it.effect.each(invariants)("preserves $name across generated scenarios", (invariant) =>
  Effect.gen(function* () {
    const values = Arbitrary.schema(
      Schema.Struct({
        millis: Schema.Int.check(
          Schema.isBetween({ minimum: -8_640_000_000_000_000, maximum: 8_640_000_000_000_000 }),
        ),
        kind: Schema.Literals(["LinkCancelled"]),
      }),
    ).pipe(
      Arbitrary.map(({ millis, kind }) => ({
        at: DateTime.makeUnsafe(millis),
        kind,
      })),
    );
    const generated = MachineTest.scenarios(ConnectionLifecycleWorkflow, {
      inputArbitrary: values.pipe(
        Arbitrary.map(({ at }) => ({
          _tag: "Linking" as const,
          provider: "yahoo" as const,
          expiresAt: at,
          updatedAt: at,
        })),
      ),
      eventsArbitrary: Arbitrary.array(
        values.pipe(
          Arbitrary.map(({ at, kind }): ConnectionLifecycleRequest => ({ _tag: kind, at })),
        ),
        { maxLength: 50 },
      ),
    });
    const result = yield* Arbitrary.checkEffect(
      generated.arbitrary,
      (scenario) =>
        Effect.gen(function* () {
          const trace = yield* MachineTest.run(ConnectionLifecycleWorkflow, scenario);
          yield* MachineTest.verify(ConnectionLifecycleWorkflow, trace);
          yield* MachineTest.checkInvariants(ConnectionLifecycleWorkflow, trace, [invariant]);
          return true;
        }),
      { seed: 20261021, runs: 100 },
    );

    assert.strictEqual(result._tag, "Passed", Arbitrary.formatCheckFailure(result));
  }),
);

const at = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
const input = {
  _tag: "Linking" as const,
  provider: "yahoo" as const,
  expiresAt: DateTime.makeUnsafe("2026-01-01T00:10:00Z"),
  updatedAt: at,
};
const cancel = { _tag: "LinkCancelled" as const, at: DateTime.makeUnsafe("2026-01-02T00:00:00Z") };
