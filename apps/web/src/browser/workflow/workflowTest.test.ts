import { expect, it } from "vitest";
import { createFSM, setup, types } from "xstate/fsm";

import { exploreWorkflow } from "./workflowTest.ts";

it("explores context changes and declared self transitions", () => {
  const workflow = setup({ schemas: { context: types<{ readonly count: number }>() } }).createFSM({
    initial: "ready",
    context: { count: 0 },
    states: {
      ready: {
        on: {
          set: { context: { count: 1 } },
          stay: { target: "ready" },
          finish: { target: "done" },
        },
      },
      done: {},
    },
  });

  const paths = exploreWorkflow(workflow, {
    events: [{ type: "set" }, { type: "stay" }, { type: "finish" }],
    invariants: { bounded: (state) => expect(state.context.count).toBeLessThanOrEqual(1) },
  });

  expect(paths.nodes).toHaveLength(4);
  expect(paths.nodes.map(({ snapshot }) => snapshot.state.path)).toContain("done");
});

it("reports a failing state with its shortest event path", () => {
  const workflow = createFSM({
    initial: "ready",
    states: { ready: { on: { finish: { target: "done" } } }, done: {} },
  });

  expect(() =>
    exploreWorkflow(workflow, {
      events: [{ type: "finish" }],
      invariants: { unfinished: (state) => expect(state.value).not.toBe("done") },
    }),
  ).toThrow(/unfinished.*done.*finish/su);
});

it("rejects missing transition samples constructively", () => {
  const workflow = createFSM({
    initial: "ready",
    states: { ready: { on: { finish: { target: "done" } } }, done: {} },
  });

  expect(() => exploreWorkflow(workflow, { events: [], invariants: {} })).toThrow(
    /ready.finish.*sample events/su,
  );
});

it("does not count disabled function transitions as taken", () => {
  const workflow = createFSM({
    initial: "ready",
    states: { ready: { on: { blocked: () => undefined } } },
  });

  expect(() =>
    exploreWorkflow(workflow, {
      events: [{ type: "blocked" }],
      invariants: {},
    }),
  ).toThrow(/ready.blocked/su);
});

it("rejects an accepted event from a declared final state", () => {
  const workflow = createFSM({
    initial: "ready",
    states: {
      ready: { on: { finish: { target: "done" } } },
      done: { on: { again: { target: "ready" } } },
    },
  });

  expect(() =>
    exploreWorkflow(workflow, {
      events: [{ type: "finish" }, { type: "again" }],
      invariants: {},
      final: (state) => state.value === "done",
    }),
  ).toThrow(/Final state done accepted again/u);
});
