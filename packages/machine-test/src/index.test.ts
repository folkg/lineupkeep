import { expect, it } from "vitest";

import {
  checkInvariants,
  explore,
  invariants,
  MachineTestFailure,
  run,
  verify,
  type MachineAdapter,
} from "./index.ts";

const adapter: MachineAdapter<State, Event> = {
  statePath: (state) => state.path,
  stateKey: (state) => `${state.path}.${state.count}`,
  eventName: (event) => event,
  events: () => ["keep", "advance", "finish", "unknown"],
  isFinal: (state) => state.path === "done",
  declarations: [
    { id: "ready.keep", from: "ready", event: "keep" },
    { id: "ready.advance", from: "ready", event: "advance" },
    { id: "ready.finish", from: "ready", event: "finish" },
  ],
  transitionId: (state, event) =>
    state.path === "ready" && event !== "unknown" ? `ready.${event}` : undefined,
  expectedTarget: (state, event) => (event === "finish" ? "done" : state.path),
  transition: (state, event) => {
    if (state.path === "done" || event === "unknown") {
      return undefined;
    }
    if (event === "finish") {
      return { path: "done", count: state.count };
    }
    return { path: "ready", count: event === "advance" ? 1 : state.count };
  },
};

it("explores reachable states and counts declared branches", () => {
  const result = explore(adapter, { input: { path: "ready", count: 0 } });

  expect(
    result.nodes.map(({ snapshot }) => `${snapshot.state.path}.${snapshot.state.value.count}`),
  ).toEqual(["ready.0", "ready.1", "done.0", "done.1"]);
  expect(result.transitionCoverage).toEqual({
    definitions: { missing: 0 },
    branches: { missing: 0 },
    uncovered: [],
  });
});

it("counts declarations that no sample event can take", () => {
  const result = explore(
    { ...adapter, events: () => ["keep", "unknown"] as const },
    {
      input: { path: "ready", count: 0 },
    },
  );

  expect(result.transitionCoverage).toEqual({
    definitions: { missing: 2 },
    branches: { missing: 2 },
    uncovered: ["ready.advance", "ready.finish"],
  });
});

it("rejects an accepted transition out of a terminal state", () => {
  expect(() =>
    explore(
      {
        ...adapter,
        transition: (state, event) =>
          state.path === "done" && event === "keep" ? state : adapter.transition(state, event),
      },
      { input: { path: "ready", count: 0 } },
    ),
  ).toThrow(/Final state done accepted keep/u);
});

it("reports invariant failures with the shortest event prefix", () => {
  const checks = invariants<State, Event>();

  expect(() =>
    explore(adapter, {
      input: { path: "ready", count: 0 },
      invariants: [checks.state("never done", ({ snapshot }) => snapshot.state.path !== "done")],
    }),
  ).toThrow(/never done.*done.*finish/su);
});

it("records accepted no-ops and checks rejected steps too", () => {
  const trace = run(adapter, {
    input: { path: "ready", count: 0 },
    events: ["keep", "unknown"] as ReadonlyArray<Event>,
  });
  const checks = invariants<State, Event>();

  expect(trace.steps.map(({ accepted }) => accepted)).toEqual([true, false]);
  expect(trace.final.state.value).toEqual({ path: "ready", count: 0 });
  expect(() =>
    checkInvariants(adapter, trace, [
      checks.step("unknown rejected", ({ event }) => event !== "unknown"),
    ]),
  ).toThrow(MachineTestFailure);
  expect(() => verify(adapter, trace)).not.toThrow();
});

it("rejects a trace whose accepted target differs from its declaration", () => {
  const trace = run(adapter, {
    input: { path: "ready", count: 0 },
    events: ["finish"] as ReadonlyArray<Event>,
  });

  expect(() =>
    verify(adapter, {
      ...trace,
      steps: trace.steps.map((step) => ({
        ...step,
        after: { state: { path: "ready", value: step.after.state.value } },
      })),
    }),
  ).toThrow(/does not declare that transition/u);
});

it("rejects a transition id belonging to another event", () => {
  const trace = run(adapter, { input: { path: "ready", count: 0 }, events: ["keep"] });

  expect(() => verify({ ...adapter, transitionId: () => "ready.finish" }, trace)).toThrow(
    /does not declare that transition/u,
  );
});

type State = { readonly path: "ready" | "done"; readonly count: number };
type Event = "keep" | "advance" | "finish" | "unknown";
