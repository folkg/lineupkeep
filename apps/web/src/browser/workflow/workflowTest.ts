import type { ActorLogic, EventObject, Snapshot } from "xstate";
import { adjacencyMapToArray, getAdjacencyMap, getShortestPaths } from "xstate/graph";
import type { StatePath } from "xstate/graph";

export function play<State, Event>(
  workflow: {
    readonly initialState: State;
    readonly transition: (
      state: State,
      event: Event,
    ) => readonly [State, ...ReadonlyArray<unknown>];
  },
  events: ReadonlyArray<Event>,
  initialState = workflow.initialState,
  invariants: Invariants<State, Event> = {},
): State {
  checkInvariants(invariants, initialState, initialState, undefined, []);
  return events.reduce((previous, event, index) => {
    const state = workflow.transition(previous, event)[0];
    checkInvariants(invariants, state, previous, event, events.slice(0, index + 1));
    return state;
  }, initialState);
}

export function exploreWorkflow<
  State extends Snapshot<unknown> & { readonly value: string; readonly context: object },
  Event extends EventObject,
>(
  workflow: ActorLogic<State, Event, unknown> & {
    readonly config: { readonly states: Readonly<Record<string, { readonly on?: object }>> };
  },
  options: { readonly events: ReadonlyArray<Event>; readonly invariants: Invariants<State, Event> },
): ReadonlyArray<StatePath<State, Event>> {
  const traversal = {
    events: options.events,
    serializeState: (state: State) => JSON.stringify(state),
    limit: 1_000_000,
  };
  const adjacency = getAdjacencyMap(workflow, traversal);
  const paths = getShortestPaths(workflow, traversal);
  const pathsByState = new Map(paths.map((path) => [JSON.stringify(path.state), path]));
  const taken = new Set<string>();
  for (const key of Object.keys(adjacency)) {
    if (!pathsByState.has(key)) {
      throw new Error(
        `Incomplete workflow exploration at ${key}; include all reachable sample events.`,
      );
    }
  }
  for (const path of paths) {
    const events = path.steps
      .map((step) => step.event)
      .filter((event) => event.type !== "xstate.init");
    checkInvariants(options.invariants, path.state, path.state, undefined, events);
  }
  for (const { state: previous, event, nextState: state } of adjacencyMapToArray(adjacency)) {
    const path = pathsByState.get(JSON.stringify(previous));
    if (path === undefined || !pathsByState.has(JSON.stringify(state))) {
      throw new Error(
        `Incomplete workflow exploration at ${JSON.stringify(state)}; include all reachable sample events.`,
      );
    }
    const events = path.steps
      .map((step) => step.event)
      .filter((event) => event.type !== "xstate.init");
    checkInvariants(options.invariants, state, previous, event, [...events, event]);
    const definition: unknown = Object.entries(
      workflow.config.states[previous.value]?.on ?? {},
    ).find(([type]) => type === event.type)?.[1];
    if (
      definition !== undefined &&
      (typeof definition !== "function" ||
        Reflect.apply(definition, undefined, [{ context: previous.context, event }]) !== undefined)
    ) {
      taken.add(`${previous.value}.${event.type}`);
    }
  }
  const missing = Object.entries(workflow.config.states)
    .flatMap(([state, definition]) =>
      Object.keys(definition.on ?? {}).map((event) => `${state}.${event}`),
    )
    .filter((transition) => !taken.has(transition));
  if (missing.length > 0) {
    throw new Error(
      `Untaken workflow transitions: ${missing.join(", ")}; add sample events that enable each declared transition.`,
    );
  }
  return paths;
}

function checkInvariants<State, Event>(
  invariants: Invariants<State, Event>,
  state: State,
  previous: State,
  event: Event | undefined,
  path: ReadonlyArray<Event>,
): void {
  for (const [name, invariant] of Object.entries(invariants)) {
    try {
      invariant(state, previous, event);
    } catch (cause) {
      throw new Error(
        `Workflow invariant "${name}" failed. State: ${JSON.stringify(state)}. Shortest event path (exploration) or replay prefix: ${JSON.stringify(path)}`,
        { cause },
      );
    }
  }
}

type Invariants<State, Event> = Readonly<
  Record<string, (state: State, previous: State, event: Event | undefined) => void>
>;
