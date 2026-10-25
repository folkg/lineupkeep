import { createRoot, flush } from "solid-js";
import { expect, it } from "vitest";
import { setup, types } from "xstate/fsm";

import { useWorkflow } from "./useWorkflow";

it("runs a state's work when the workflow enters it and records the outcome", async () => {
  const requests: Array<string> = [];
  using workflow = runLoader((state, send) => {
    if (state.value === "loading") {
      requests.push("load");
      return Promise.resolve().then(() => send({ type: "loaded" }));
    }
  });

  await workflow.send({ type: "load" });
  flush();

  expect(workflow.state().value).toBe("loaded");
  expect(requests).toEqual(["load"]);
});

it("does not repeat a state's work for events that keep the workflow in it", async () => {
  const requests: Array<string> = [];
  using workflow = runLoader((state) => {
    if (state.value === "loading") {
      requests.push("load");
    }
  });

  await workflow.send({ type: "load" });
  await workflow.send({ type: "load" });

  expect(requests).toEqual(["load"]);
});

it("ignores outcomes that arrive after its owner is disposed", async () => {
  const response = Promise.withResolvers<void>();
  using workflow = runLoader((state, send) =>
    state.value === "loading" ? response.promise.then(() => send({ type: "loaded" })) : undefined,
  );
  const loading = workflow.send({ type: "load" });
  await Promise.resolve();

  workflow[Symbol.dispose]();
  response.resolve();
  await loading;
  flush();

  expect(workflow.state().value).toBe("loading");
});

const loader = setup({
  schemas: { events: { load: types<object>(), loaded: types<object>() } },
}).createFSM({
  initial: "idle",
  states: {
    idle: { on: { load: "loading" } },
    loading: { on: { load: "loading", loaded: "loaded" } },
    loaded: {},
  },
});

function runLoader(
  onEnter: (
    state: LoaderState,
    send: (event: LoaderEvent) => Promise<void>,
  ) => Promise<void> | void,
): {
  state: import("solid-js").Accessor<LoaderState>;
  send: (event: LoaderEvent) => Promise<void>;
  [Symbol.dispose]: () => void;
} {
  return createRoot((dispose) => {
    const workflow = useWorkflow(loader, {
      onEnter,
    });
    flush();
    return { ...workflow, [Symbol.dispose]: dispose };
  });
}

type LoaderState = typeof loader.initialState;

type LoaderEvent = Parameters<typeof loader.transition>[1];
