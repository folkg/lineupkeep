import { createSignal, onSettled } from "solid-js";
import type { Accessor } from "solid-js";

export function useWorkflow<TState extends WorkflowState, TEvent extends WorkflowEvent>(
  workflow: Workflow<TState, TEvent>,
  options: WorkflowOptions<TState, TEvent> = {},
): RunningWorkflow<TState, TEvent> {
  let current = options.initialState ?? workflow.initialState;
  let disposed = false;
  const [committed, setCommitted] = createSignal({ state: current });
  onSettled(() => () => {
    disposed = true;
  });

  const send: Send<TEvent> = (event) => {
    if (disposed) {
      return Promise.resolve();
    }
    const previous = current;
    [current] = workflow.transition(previous, event);
    if (current === previous) {
      return Promise.resolve();
    }
    setCommitted({ state: current });
    return current.value === previous.value
      ? Promise.resolve()
      : Promise.resolve(options.onEnter?.(current, send));
  };

  return { state: () => committed().state, send };
}

export type RunningWorkflow<TState extends WorkflowState, TEvent extends WorkflowEvent> = {
  readonly state: Accessor<TState>;

  readonly send: Send<TEvent>;
};

type WorkflowOptions<TState, TEvent> = {
  readonly initialState?: TState;
  readonly onEnter?: (state: TState, send: Send<TEvent>) => Promise<void> | void;
};

type Send<TEvent> = (event: TEvent) => Promise<void>;

type Workflow<TState, TEvent> = {
  readonly initialState: TState;
  readonly transition: (
    state: TState,
    event: TEvent,
  ) => readonly [TState, ...ReadonlyArray<unknown>];
};

type WorkflowState = { readonly value: string };

type WorkflowEvent = { readonly type: string };
