import { assert, it } from "@effect/vitest";
import { Machine } from "@typeonce/effect-machine";
import { MachineTest } from "@typeonce/effect-machine/testing";
import { Arbitrary, DateTime, Effect, Schema } from "effect";

import { ConnectionCredentialGeneration } from "#contexts/connections/Connection.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";

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
    "only Ready owns approvedAt",
    ({ snapshot }) => "approvedAt" in snapshot.state.value === (snapshot.state.path === "Ready"),
  ),
  define.state(
    "Ready and ReconnectRequired own a credential generation",
    ({ snapshot }) =>
      "credentialGeneration" in snapshot.state.value ===
      (snapshot.state.path === "Ready" || snapshot.state.path === "ReconnectRequired"),
  ),
  define.state(
    "only ReconnectRequired owns reconnectRequiredAt",
    ({ snapshot }) =>
      "reconnectRequiredAt" in snapshot.state.value ===
      (snapshot.state.path === "ReconnectRequired"),
  ),
  define.state(
    "only Disconnected owns disconnectedAt",
    ({ snapshot }) =>
      "disconnectedAt" in snapshot.state.value === (snapshot.state.path === "Disconnected"),
  ),
  define.step(
    "an accepted completion timestamps the event and generation",
    ({ before, after, event }) =>
      before.state.path !== "Linking" ||
      event._tag !== "LinkCompleted" ||
      (after.state.value._tag === "Ready" &&
        DateTime.Equivalence(after.state.value.approvedAt, event.at) &&
        after.state.value.credentialGeneration === event.credentialGeneration &&
        DateTime.Equivalence(after.state.value.updatedAt, event.at)),
  ),
  define.step(
    "an accepted reconnect-required transition preserves the generation",
    ({ before, after, event }) =>
      before.state.path !== "Ready" ||
      event._tag !== "ReconnectRequired" ||
      (after.state.value._tag === "ReconnectRequired" &&
        after.state.value.credentialGeneration === before.state.value.credentialGeneration &&
        DateTime.Equivalence(after.state.value.reconnectRequiredAt, event.at)),
  ),
  define.step(
    "an accepted reconnect timestamps the event and replaces the generation",
    ({ before, after, event }) =>
      (before.state.path !== "Ready" && before.state.path !== "ReconnectRequired") ||
      event._tag !== "Reconnected" ||
      (after.state.value._tag === "Ready" &&
        after.state.value.credentialGeneration === event.credentialGeneration &&
        DateTime.Equivalence(after.state.value.approvedAt, event.at)),
  ),
  define.step(
    "an accepted disconnection timestamps the event",
    ({ before, after, event }) =>
      before.state.path === "Disconnected" ||
      event._tag !== "Disconnected" ||
      (after.state.value._tag === "Disconnected" &&
        DateTime.Equivalence(after.state.value.disconnectedAt, event.at)),
  ),
  define.state("Disconnected is terminal and accepts no event", ({ snapshot }) => {
    if (snapshot.state.path !== "Disconnected") {
      return true;
    }
    return events.every((event) => {
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
      events: () => events,
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
        generation: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
        kind: Schema.Literals([
          "LinkCompleted",
          "ReconnectRequired",
          "Reconnected",
          "Disconnected",
        ]),
      }),
    ).pipe(
      Arbitrary.map(({ millis, generation, kind }) => ({
        at: DateTime.makeUnsafe(millis),
        generation,
        kind,
      })),
    );
    const generated = MachineTest.scenarios(ConnectionLifecycleWorkflow, {
      inputArbitrary: values.pipe(
        Arbitrary.map(({ at }) => ({
          _tag: "Linking" as const,
          provider: decodeProviderKey("yahoo"),
          expiresAt: at,
          updatedAt: at,
        })),
      ),
      eventsArbitrary: Arbitrary.array(
        values.pipe(
          Arbitrary.map(({ at, generation, kind }): ConnectionLifecycleRequest => {
            switch (kind) {
              case "LinkCompleted":
              case "Reconnected":
                return {
                  _tag: kind,
                  at,
                  credentialGeneration: makeGeneration(generation),
                };
              case "ReconnectRequired":
              case "Disconnected":
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

function makeGeneration(value: number): ConnectionCredentialGeneration {
  return Schema.decodeSync(ConnectionCredentialGeneration)(value);
}

const at = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
const input = {
  _tag: "Linking" as const,
  provider: decodeProviderKey("yahoo"),
  expiresAt: DateTime.makeUnsafe("2026-01-01T00:10:00Z"),
  updatedAt: at,
};
const linkCompleted = {
  _tag: "LinkCompleted" as const,
  at: DateTime.makeUnsafe("2026-01-02T00:00:00Z"),
  credentialGeneration: makeGeneration(1),
};
const reconnectRequired = {
  _tag: "ReconnectRequired" as const,
  at: DateTime.makeUnsafe("2026-01-03T00:00:00Z"),
};
const reconnected = {
  _tag: "Reconnected" as const,
  at: DateTime.makeUnsafe("2026-01-04T00:00:00Z"),
  credentialGeneration: makeGeneration(2),
};
const disconnected = {
  _tag: "Disconnected" as const,
  at: DateTime.makeUnsafe("2026-01-05T00:00:00Z"),
};
const events: ReadonlyArray<ConnectionLifecycleRequest> = [
  linkCompleted,
  reconnectRequired,
  reconnected,
  disconnected,
];
