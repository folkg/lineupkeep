import * as Shared from "@lineupkeep/machine-test";
import type { EventObject } from "xstate";

export function play<
  State extends { readonly value: string; readonly context: object },
  Event extends EventObject,
>(
  workflow: Workflow<State, Event>,
  events: ReadonlyArray<Event>,
  initialState = workflow.initialState,
  invariants: Invariants<State, Event> = {},
): State {
  const adapter = workflowAdapter(workflow, { events, final: () => false });
  const checks = workflowInvariants(adapter, invariants);
  checkInitial(invariants, initialState);
  const trace = Shared.run(adapter, { input: initialState, events });
  Shared.checkInvariants(adapter, trace, checks);
  return trace.final.state.value;
}

export function exploreWorkflow<
  State extends { readonly value: string; readonly context: object },
  Event extends EventObject,
>(
  workflow: Workflow<State, Event>,
  options: {
    readonly events: ReadonlyArray<Event>;
    readonly invariants: Invariants<State, Event>;
    readonly final?: (state: State) => boolean;
    readonly stateKey?: (state: State) => string;
  },
): Shared.Exploration<State> {
  const adapter = workflowAdapter(workflow, options);
  checkInitial(options.invariants, workflow.initialState);
  const explored = Shared.explore(adapter, {
    input: workflow.initialState,
    invariants: workflowInvariants(adapter, options.invariants),
  });
  if (explored.transitionCoverage.definitions.missing > 0) {
    throw new Shared.MachineTestFailure(
      `Untaken workflow transitions: ${explored.transitionCoverage.uncovered.join(", ")}; add sample events that enable each declared transition.`,
    );
  }
  return explored;
}

function workflowAdapter<
  State extends { readonly value: string; readonly context: object },
  Event extends EventObject,
>(
  workflow: Workflow<State, Event>,
  options: {
    readonly events: ReadonlyArray<Event>;
    readonly final?: (state: State) => boolean;
    readonly stateKey?: (state: State) => string;
  },
): Shared.MachineAdapter<State, Event> {
  const declarations = Object.entries(workflow.config.states).flatMap(([from, definition]) =>
    Object.keys(definition.on ?? {}).map((event) => ({ id: `${from}.${event}`, from, event })),
  );
  const declared = (state: State, event: Event): boolean => {
    const definition = workflow.config.states[state.value]?.on?.[event.type];
    return (
      definition !== undefined &&
      (typeof definition !== "function" ||
        Reflect.apply(definition, undefined, [{ context: state.context, event }]) !== undefined)
    );
  };
  return {
    statePath: (state) => state.value,
    stateKey: options.stateKey ?? ((state) => JSON.stringify(state)),
    events: () => options.events,
    eventName: (event) => event.type,
    isFinal: options.final ?? (() => false),
    declarations,
    transitionId: (state, event) =>
      declared(state, event) ? `${state.value}.${event.type}` : undefined,
    expectedTarget: (state, event) => {
      const definition = workflow.config.states[state.value]?.on?.[event.type];
      const transition: unknown =
        typeof definition === "function"
          ? Reflect.apply(definition, undefined, [{ context: state.context, event }])
          : definition;
      if (transition === undefined) {
        return undefined;
      }
      if (
        typeof transition === "object" &&
        transition !== null &&
        "target" in transition &&
        typeof transition.target === "string"
      ) {
        return transition.target;
      }
      return state.value;
    },
    transition: (state, event) =>
      declared(state, event) ? workflow.transition(state, event)[0] : undefined,
  };
}

function workflowInvariants<State, Event>(
  adapter: Shared.MachineAdapter<State, Event>,
  invariants: Invariants<State, Event>,
): ReadonlyArray<Shared.Invariant<State, Event>> {
  return Object.entries(invariants).map(([name, check]): Shared.Invariant<State, Event> => ({
    _tag: "StepInvariant" as const,
    name,
    check: ({
      before,
      after,
      event,
    }: {
      readonly before: Shared.TestSnapshot<State>;
      readonly after: Shared.TestSnapshot<State>;
      readonly event: Event;
    }) => {
      try {
        check(after.state.value, before.state.value, event);
        return true;
      } catch (cause) {
        throw new Shared.MachineTestFailure(
          `Workflow invariant "${name}" failed. State: ${adapter.statePath(after.state.value)}. Event: ${adapter.eventName(event)}; ${String(cause)}`,
        );
      }
    },
  }));
}

function checkInitial<State, Event>(invariants: Invariants<State, Event>, state: State): void {
  for (const [name, check] of Object.entries(invariants)) {
    try {
      check(state, state, undefined);
    } catch (cause) {
      throw new Shared.MachineTestFailure(
        `Workflow invariant "${name}" failed. State: ${String(state)}; ${String(cause)}`,
      );
    }
  }
}

type Workflow<State, Event extends EventObject> = {
  readonly initialState: State;
  readonly transition: (state: State, event: Event) => readonly [State, ...ReadonlyArray<unknown>];
  readonly config: {
    readonly states: Readonly<Record<string, { readonly on?: Readonly<Record<string, unknown>> }>>;
  };
};

type Invariants<State, Event> = Readonly<
  Record<string, (state: State, previous: State, event: Event | undefined) => void>
>;
