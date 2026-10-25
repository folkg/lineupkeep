import { assert, it } from "@effect/vitest";
import { Machine } from "@typeonce/effect-machine";
import { Effect, Exit, Schema } from "effect";

import { planBatch, snapshotOf, TransitionRejected } from "./machine.ts";

it.effect("returns changed snapshots, omits handled no-ops, and preserves batch order", () =>
  Effect.gen(function* () {
    const changed = yield* planBatch(
      counter,
      [
        { id: "second", input: [2] },
        { id: "first", input: [1] },
      ],
      { _tag: "Increment" },
    );
    const unchanged = yield* planBatch(counter, [{ id: "first", input: [1] }], { _tag: "Keep" });
    const empty = yield* planBatch(counter, [], { _tag: "Increment" });

    assert.deepStrictEqual(
      changed.map(({ id, snapshot }) => [id, snapshot.value.count]),
      [
        ["second", 3],
        ["first", 2],
      ],
    );
    assert.deepStrictEqual(unchanged, []);
    assert.deepStrictEqual(empty, []);
  }),
);

it.effect("plans from a decoded snapshot instead of reconstructing startup state", () =>
  Effect.gen(function* () {
    const stored = {
      _tag: "MachineSnapshot",
      version: 2,
      active: [{ path: "", value: { _tag: "", count: 41 } }],
    } satisfies Machine.Machine.EncodedSnapshot;
    const snapshot = yield* Machine.decodeSnapshot(counter, stored);

    const changed = yield* planBatch(counter, [{ id: "stored", snapshot }], { _tag: "Increment" });
    const unchanged = yield* planBatch(counter, [{ id: "stored", snapshot }], { _tag: "Keep" });

    assert.strictEqual(changed.length, 1);
    assert.strictEqual(changed[0]?.snapshot.value.count, 42);
    assert.deepStrictEqual(unchanged, []);
  }),
);

it.effect("rejects unhandled events with the target, initial snapshot, and decoded event", () =>
  Effect.gen(function* () {
    const rejected = yield* Effect.flip(
      planBatch(counter, [{ id: "target", input: [1] }], { _tag: "Unhandled" }),
    );

    assert.instanceOf(rejected, TransitionRejected);
    assert.strictEqual(rejected.id, "target");
    assert.strictEqual(rejected.state.value.count, 1);
    assert.deepStrictEqual(rejected.event, { _tag: "Unhandled" });
  }),
);

it.effect("resumes an atomic root without requiring startup input", () =>
  Effect.gen(function* () {
    const snapshot = yield* snapshotOf(counter, { _tag: "", count: 41 });
    const planned = yield* Machine.plan(counter, snapshot, { _tag: "Increment" });

    assert.strictEqual(snapshot.value.count, 41);
    assert.strictEqual(planned.next.value.count, 42);
  }),
);

it.effect("preserves a state's two-way schema encoding when resuming", () =>
  Effect.gen(function* () {
    const root = Machine.state({ fields: { count: Schema.FiniteFromString } });
    const machine = Machine.make({
      root,
      input: Schema.Finite,
      events: Machine.events({ Keep: {} }),
    }).handle({
      root: ({ input }) => ({ count: input }),
      on: { Keep: { none: true } },
    });
    const restored = yield* snapshotOf(machine, { _tag: "", count: 41 });
    const encoded = yield* Machine.encodeSnapshot(machine, restored);

    assert.strictEqual(restored.value.count, 41);
    assert.deepStrictEqual(encoded.active, [{ path: "", value: { _tag: "", count: "41" } }]);
  }),
);

it.effect("rejects unknown snapshot states with guidance instead of reconstructing startup", () =>
  Effect.gen(function* () {
    const rejected = yield* Effect.exit(snapshotOf(counter, { _tag: "Missing" }));

    assert.isTrue(Exit.isFailure(rejected));
    assert.include(String(rejected), "top-level state with a schema");
    assert.include(String(rejected), "decodeSnapshot");
  }),
);

const Root = Machine.state({ fields: { count: Schema.Finite } });
const counter = Machine.make({
  root: Root,
  input: Schema.Finite,
  events: Machine.events({ Increment: {}, Keep: {}, Unhandled: {} }),
}).handle({
  root: ({ input }) => ({ count: input }),
  on: {
    Increment: { update: "root", data: ({ root }) => ({ count: root.count + 1 }) },
    Keep: { none: true },
  },
});
