import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  type DefinedMachine,
  defineMachine,
  final,
  plan,
  planBatch,
  snapshotOf,
  TransitionRejected,
} from "./machine.ts";

const CounterState = Schema.TaggedUnion({
  Counting: { count: Schema.Finite },
  Done: { count: Schema.Finite },
});
type CounterState = typeof CounterState.Type;

const CounterEvents = Schema.TaggedUnion({
  Increment: {},
  Keep: {},
  Finish: {},
  Unhandled: {},
});
type CounterEvent = typeof CounterEvents.Type;

const counter: DefinedMachine<CounterState, CounterEvent> = defineMachine<
  CounterState,
  CounterEvent
>({
  root: {
    Counting: CounterState.cases.Counting,
    Done: final(CounterState.cases.Done),
  },
  events: CounterEvents,
  initial: { target: "Counting", data: ({ input }) => input },
  states: {
    Counting: {
      on: {
        Increment: { target: "Counting", data: ({ state }) => ({ count: state.count + 1 }) },
        Keep: { target: "Counting", data: ({ state }) => ({ count: state.count }) },
        Finish: { target: "Done", data: ({ state }) => ({ count: state.count }) },
      },
    },
    Done: {},
  },
});

it.effect("returns changed snapshots, omits handled no-ops, and preserves batch order", () =>
  Effect.gen(function* () {
    const changed = yield* planBatch(
      counter,
      [
        { id: "second", input: { _tag: "Counting", count: 2 } },
        { id: "first", input: { _tag: "Counting", count: 1 } },
      ],
      { _tag: "Increment" },
    );
    const unchanged = yield* planBatch(
      counter,
      [{ id: "first", input: { _tag: "Counting", count: 1 } }],
      { _tag: "Keep" },
    );
    const empty = yield* planBatch(counter, [], { _tag: "Increment" });

    assert.deepStrictEqual(
      changed.map(({ id, snapshot }) => [
        id,
        snapshot.state._tag === "Counting" && snapshot.state.count,
      ]),
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
    const snapshot = yield* snapshotOf(counter, { _tag: "Counting", count: 41 });
    const next = yield* plan(counter, snapshot, { _tag: "Increment" });
    const same = yield* plan(counter, snapshot, { _tag: "Keep" });

    assert.deepStrictEqual(next, { _tag: "Counting", count: 42 });
    assert.deepStrictEqual(same, { _tag: "Counting", count: 41 });
  }),
);

it.effect("rejects unhandled events with the target, initial snapshot, and decoded event", () =>
  Effect.gen(function* () {
    const rejected = yield* Effect.flip(
      planBatch(counter, [{ id: "target", input: { _tag: "Counting", count: 1 } }], {
        _tag: "Unhandled",
      }),
    );

    assert.instanceOf(rejected, TransitionRejected);
    assert.strictEqual(rejected.id, "target");
    assert.deepStrictEqual(rejected.state, { _tag: "Counting", count: 1 });
    assert.deepStrictEqual(rejected.event, { _tag: "Unhandled" });
  }),
);

it.effect("resumes a stored top-level state without requiring startup input", () =>
  Effect.gen(function* () {
    const snapshot = yield* snapshotOf(counter, { _tag: "Counting", count: 41 });
    const planned = yield* plan(counter, snapshot, { _tag: "Increment" });

    assert.deepStrictEqual(planned, { _tag: "Counting", count: 42 });
  }),
);

it.effect("preserves a state's two-way schema encoding when resuming", () =>
  Effect.gen(function* () {
    const twoWay: DefinedMachine<
      { readonly _tag: "Counting"; readonly count: number },
      CounterEvent
    > = defineMachine<{ readonly _tag: "Counting"; readonly count: number }, CounterEvent>({
      root: { Counting: Schema.TaggedStruct("Counting", { count: Schema.FiniteFromString }) },
      events: CounterEvents,
      initial: { target: "Counting", data: ({ input }) => input },
      states: {
        Counting: {
          on: {
            Increment: {
              target: "Counting",
              data: ({ state }) => ({ count: state.count + 1 }),
            },
          },
        },
      },
    });
    const snapshot = yield* snapshotOf(twoWay, { _tag: "Counting", count: 41 });
    const next = yield* plan(twoWay, snapshot, { _tag: "Increment" });

    assert.deepStrictEqual(snapshot.state, { _tag: "Counting", count: 41 });
    assert.deepStrictEqual(next, { _tag: "Counting", count: 42 });
  }),
);
