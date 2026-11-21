import { assert, it } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Schema, SchemaParser } from "effect";
import { Array as EffectArray } from "effect";
import { Option as EffectOption, Order as EffectOrder } from "effect";

import { plan, snapshotOf } from "#utilities/machine.ts";
import * as MachineTest from "#utilities/machineTest.ts";

import {
  ConnectionIncidentEvent,
  ConnectionIncidentState,
  ConnectionIncidentWorkflow,
  connectionIncidentProjection,
  connectionIncidentState,
  connectionIncidentStatus,
  initialConnectionIncidentState,
} from "./ConnectionIncidentWorkflow.ts";
import { connectionIncidents } from "./IncidentTables.ts";

const at = DateTime.makeUnsafe("2026-10-25T12:00:00Z");
const later = DateTime.makeUnsafe("2026-10-25T12:01:00Z");
const events: ReadonlyArray<ConnectionIncidentEvent> = [
  { _tag: "Resolved", at: later, resolution: "reconnected" },
  { _tag: "Resolved", at: later, resolution: "disconnected" },
];
const define = MachineTest.invariants(ConnectionIncidentWorkflow);
const resolutionInvariant = define.step(
  "a resolution records the event once",
  ({ before, after, event }) =>
    before.state.path === "resolved"
      ? Schema.toEquivalence(ConnectionIncidentState)(before.state.value, after.state.value)
      : after.state.value._tag === "resolved" &&
        DateTime.Equivalence(after.state.value.resolvedAt, event.at) &&
        after.state.value.resolution === event.resolution,
);
const invariants = [
  define.state("every incident retains its opening time", ({ snapshot }) =>
    DateTime.Equivalence(snapshot.state.value.openedAt, at),
  ),
  resolutionInvariant,
];

it.effect("explores open and resolved with full coverage and terminal rejection", () =>
  Effect.gen(function* () {
    const explored = yield* MachineTest.explore(ConnectionIncidentWorkflow, {
      input: initialConnectionIncidentState(at),
      events: () => events,
      stateKey: ({ snapshot }) => snapshot.state.path,
      invariants,
    });
    assert.strictEqual(explored.completeness._tag, "Complete");
    assert.strictEqual(explored.transitionCoverage.definitions.missing, 0);
    assert.strictEqual(explored.transitionCoverage.branches.missing, 0);
    const statuses = ["open", "resolved"];
    assert.deepStrictEqual(
      [...new Set(EffectArray.map(explored.nodes, ({ snapshot }) => snapshot.state.path))].sort(),
      statuses,
    );
    assert.deepStrictEqual(
      EffectArray.sort(connectionIncidents.status.enumValues, EffectOrder.String),
      statuses,
    );
    const terminal = EffectOption.getOrUndefined(
      EffectArray.findFirst(explored.nodes, ({ snapshot }) => snapshot.state.path === "resolved"),
    );
    assert.isDefined(terminal);
    const trace = yield* MachineTest.run(ConnectionIncidentWorkflow, {
      input: terminal.snapshot.state.value,
      events,
    });
    assert.isTrue(EffectArray.every(trace.steps, (step) => !step.accepted));
  }),
);

it.effect("generates incident event sequences and checks invariants", () =>
  Effect.gen(function* () {
    const generated = MachineTest.scenarios(ConnectionIncidentWorkflow, {
      inputArbitrary: Arbitrary.schema(Schema.DateTimeUtc).pipe(
        Arbitrary.map(initialConnectionIncidentState),
      ),
      eventsArbitrary: Arbitrary.array(Arbitrary.schema(ConnectionIncidentEvent), {
        maxLength: 40,
      }),
    });
    const result = yield* Arbitrary.checkEffect(
      generated.arbitrary,
      (scenario) =>
        Effect.gen(function* () {
          const trace = yield* MachineTest.run(ConnectionIncidentWorkflow, scenario);
          yield* MachineTest.verify(ConnectionIncidentWorkflow, trace);
          yield* MachineTest.checkInvariants(ConnectionIncidentWorkflow, trace, [
            define.state("opening time is preserved", ({ snapshot }) =>
              DateTime.Equivalence(snapshot.state.value.openedAt, scenario.input.openedAt),
            ),
            resolutionInvariant,
          ]);
          return true;
        }),
      { seed: 20261120, runs: 100 },
    );
    assert.strictEqual(result._tag, "Passed", Arbitrary.formatCheckFailure(result));
  }),
);

it.effect("round-trips both states through JSON and resumes a stored open incident", () =>
  Effect.gen(function* () {
    const states: ReadonlyArray<ConnectionIncidentState> = [
      initialConnectionIncidentState(at),
      { _tag: "resolved", openedAt: at, resolvedAt: later, resolution: "disconnected" },
    ];
    for (const state of states) {
      const encoded = yield* SchemaParser.encodeEffect(Schema.toCodecJson(ConnectionIncidentState))(
        state,
      );
      const restored = yield* SchemaParser.decodeEffect(
        Schema.toCodecJson(ConnectionIncidentState),
      )(encoded);
      assert.isTrue(Schema.toEquivalence(ConnectionIncidentState)(restored, state));
      assert.strictEqual(connectionIncidentStatus(restored), state._tag);
      assert.deepStrictEqual(
        connectionIncidentState(connectionIncidentProjection(restored)),
        restored,
      );
    }
    const stored = yield* SchemaParser.decodeEffect(Schema.toCodecJson(ConnectionIncidentState))({
      _tag: "open",
      openedAt: "2026-10-25T12:00:00.000Z",
    });
    const next = yield* plan(
      ConnectionIncidentWorkflow,
      yield* snapshotOf(ConnectionIncidentWorkflow, stored),
      { _tag: "Resolved", at: later, resolution: "reconnected" },
    );
    assert.deepStrictEqual(next, {
      _tag: "resolved",
      openedAt: at,
      resolvedAt: later,
      resolution: "reconnected",
    });
  }),
);
