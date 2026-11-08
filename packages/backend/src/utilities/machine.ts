import { setupEffect } from "@xstate/effect";
import { Data, Effect, Equal, Schema } from "effect";
import { isUnhandled, type StateSchema as XStateSchema } from "xstate";

declare const machineTypes: unique symbol;

export type Tagged = { readonly _tag: string };

export type StateCodec<State extends Tagged> = Schema.Codec<State, unknown, never, never>;

export type StateEntry<State extends Tagged = Tagged> =
  | StateCodec<State>
  | { readonly final: true; readonly schema: StateCodec<State> };

export function final<State extends Tagged>(schema: StateCodec<State>): StateEntry<State> {
  return { final: true, schema };
}

export type MachineDefinition<State extends Tagged, Event extends Tagged> = {
  readonly root: {
    readonly [Tag in State["_tag"]]: StateEntry<Extract<State, { _tag: Tag }>>;
  } & { readonly [Tag: string]: StateEntry<State> };
  readonly events: Schema.Schema<Event> & { readonly cases: Record<string, unknown> };
  readonly initial: {
    readonly target: State["_tag"];
    readonly data: (args: { readonly input: State }) => State;
  };
  readonly states: MachineTransitions<State, Event>;
};

type MachineTransitions<State extends Tagged, Event extends Tagged> = {
  readonly [From in State["_tag"]]?: {
    readonly on?: {
      readonly [On in Event["_tag"]]?:
        | Transition<State, Event, From, On>
        | ReadonlyArray<Transition<State, Event, From, On>>;
    };
  };
} & { readonly [From: string]: unknown };

type RuntimeTransition = {
  readonly target: string;
  guard?(args: { readonly state: Tagged; readonly event: Tagged }): boolean;
  data(args: { readonly state: Tagged; readonly event: Tagged }): Omit<Tagged, "_tag">;
};

type RuntimeTransitions = Readonly<
  Record<string, RuntimeTransition | ReadonlyArray<RuntimeTransition>>
>;

type Transition<
  State extends Tagged,
  Event extends Tagged,
  From extends State["_tag"],
  On extends Event["_tag"],
> = {
  readonly [To in State["_tag"]]: {
    readonly target: To;
    guard?(args: TransitionArgs<State, Event, From, On>): boolean;
    data(args: TransitionArgs<State, Event, From, On>): Omit<Extract<State, { _tag: To }>, "_tag">;
  };
}[State["_tag"]];

type TransitionArgs<
  State extends Tagged,
  Event extends Tagged,
  From extends State["_tag"],
  On extends Event["_tag"],
> = {
  readonly state: Extract<State, { _tag: From }>;
  readonly event: Extract<Event, { _tag: On }>;
};

export type Snapshot<State extends Tagged> = { readonly state: State };

export type DefinedMachine<State extends Tagged, Event extends Tagged> = {
  readonly definition: MachineDefinition<State, Event>;
  readonly stateSchemas: Readonly<Record<string, StateCodec<State>>>;
  readonly runtime: MachineRuntime<State>;
  readonly transitionsOf: (tag: string) => RuntimeTransitions;
  readonly [machineTypes]?: { readonly state: State; readonly event: Event };
};

export function defineMachine<State extends Tagged, Event extends Tagged>(
  definition: MachineDefinition<State, Event>,
): DefinedMachine<State, Event> {
  const stateSchemas: Record<string, StateCodec<State>> = Object.fromEntries(
    Object.entries(definition.root).map(([tag, entry]) => [tag, schemaOf(entry)]),
  );
  const states = Object.fromEntries(
    Object.entries(definition.root).map(([tag, entry]) => [
      tag,
      stateConfig(entry, transitionsOf(definition, tag)),
    ]),
  );
  const state = Schema.Union(Object.values(stateSchemas));
  const context = Schema.Struct({ state });
  const machine = setupEffect({
    schemas: { context, input: state },
  }).createMachine({
    context: ({ input }: { readonly input: State }) => ({
      state: definition.initial.data({ input }),
    }),
    initial: definition.initial.target,
    states,
  } as never);
  return {
    definition,
    stateSchemas,
    runtime: machine as unknown as MachineRuntime<State>,
    transitionsOf: (tag) => transitionsOf(definition, tag),
  };
}

export function snapshotOf<State extends Tagged, Event extends Tagged>(
  machine: DefinedMachine<State, Event>,
  state: NoInfer<State>,
): Effect.Effect<Snapshot<State>, Schema.SchemaError> {
  return Effect.gen(function* () {
    const decoded = yield* decodeState(machine, state);
    machine.runtime.resolveState({ value: decoded._tag, context: { state: decoded } });
    return { state: decoded };
  });
}

export function plan<State extends Tagged, Event extends Tagged>(
  machine: DefinedMachine<State, Event>,
  snapshot: Snapshot<NoInfer<State>>,
  event: NoInfer<Event>,
): Effect.Effect<State, TransitionRejected<unknown, State, Event> | Schema.SchemaError> {
  return Effect.gen(function* () {
    const restored = machine.runtime.resolveState({
      value: snapshot.state._tag,
      context: { state: snapshot.state },
    });
    const [next, effects] = machine.runtime.transition(restored, runtimeEvent(event));
    if (isUnhandled(restored, [next, effects])) {
      return yield* new TransitionRejected({ state: snapshot.state, event });
    }
    return yield* decodeState(machine, next.context.state);
  });
}

export function planBatch<
  State extends Tagged,
  Event extends Tagged,
  Id,
  Row extends { readonly id: Id } & (
    | { readonly input: NoInfer<State> }
    | { readonly snapshot: Snapshot<NoInfer<State>> }
  ),
>(
  machine: DefinedMachine<State, Event>,
  rows: ReadonlyArray<Row>,
  event: NoInfer<Event> | ((row: Row) => NoInfer<Event>),
): Effect.Effect<
  ReadonlyArray<{ readonly id: Id; readonly row: Row; readonly snapshot: Snapshot<State> }>,
  TransitionRejected<Id, State, Event> | Schema.SchemaError
> {
  return Effect.gen(function* () {
    const changes: Array<{
      readonly id: Id;
      readonly row: Row;
      readonly snapshot: Snapshot<State>;
    }> = [];
    for (const row of rows) {
      const initial =
        "input" in row
          ? yield* snapshotOf(machine, machine.definition.initial.data({ input: row.input }))
          : row.snapshot;
      const request = typeof event === "function" ? event(row) : event;
      const next = yield* plan(machine, initial, request).pipe(
        Effect.mapError((cause) =>
          cause._tag === "TransitionRejected"
            ? new TransitionRejected({ id: row.id, state: initial.state, event: cause.event })
            : cause,
        ),
      );
      if (!Equal.equals(initial.state, next)) {
        changes.push({ id: row.id, row, snapshot: { state: next } });
      }
    }
    return changes;
  });
}

export class TransitionRejected<Id, State extends Tagged, Event> extends Data.TaggedError(
  "TransitionRejected",
)<{
  readonly id?: Id;
  readonly state: State;
  readonly event: Event;
}> {}

function stateConfig<State extends Tagged>(
  entry: StateEntry<State>,
  transitions: Record<string, RuntimeTransition | ReadonlyArray<RuntimeTransition>>,
): XStateSchema {
  const on = Object.fromEntries(
    Object.entries(transitions).map(([type, specification]) => [
      type,
      listOf(specification).map(
        (transition) =>
          (args: {
            readonly context: { readonly state: State };
            readonly event: Tagged;
          }): unknown =>
            transition.guard !== undefined &&
            !transition.guard({ state: args.context.state, event: args.event })
              ? undefined
              : {
                  target: transition.target,
                  context: {
                    state: {
                      _tag: transition.target,
                      ...transition.data({ state: args.context.state, event: args.event }),
                    },
                  },
                },
      ),
    ]),
  );
  return {
    ...(isFinal(entry) ? { type: "final" } : {}),
    ...(Object.keys(on).length === 0 ? {} : { on }),
  };
}

function schemaOf<State extends Tagged>(entry: StateEntry<State>): StateCodec<State> {
  return isFinal(entry) ? entry.schema : entry;
}

function isFinal<State extends Tagged>(
  entry: StateEntry<State>,
): entry is { readonly final: true; readonly schema: StateCodec<State> } {
  return "final" in entry;
}

function decodeState<State extends Tagged, Event extends Tagged>(
  machine: DefinedMachine<State, Event>,
  value: State,
): Effect.Effect<State, Schema.SchemaError> {
  const tag = value._tag;
  const schema = machine.stateSchemas[tag];
  if (schema === undefined) {
    throw new Error(`The machine has no state named ${tag}`);
  }
  return Effect.gen(function* () {
    const encoded = yield* Schema.encodeUnknownEffect(schema)(value);
    return yield* Schema.decodeUnknownEffect(schema)(encoded);
  });
}

function runtimeEvent(event: Tagged): { readonly type: string } {
  return { ...event, type: event._tag };
}

type MachineRuntime<State extends Tagged> = {
  readonly resolveState: (config: {
    readonly value: string;
    readonly context: { readonly state: State };
  }) => RuntimeSnapshot<State>;
  readonly transition: (
    snapshot: RuntimeSnapshot<State>,
    event: { readonly type: string },
  ) => [RuntimeSnapshot<State>, ReadonlyArray<unknown>];
};

type RuntimeSnapshot<State extends Tagged> = {
  readonly status: string;
  readonly value: string;
  readonly context: { readonly state: State };
};

function transitionsOf<State extends Tagged, Event extends Tagged>(
  definition: MachineDefinition<State, Event>,
  tag: string,
): RuntimeTransitions {
  const states = definition.states as unknown as Record<
    string,
    { readonly on?: RuntimeTransitions } | undefined
  >;
  return states[tag]?.on ?? {};
}

function listOf<Value>(value: Value | ReadonlyArray<Value> | undefined): ReadonlyArray<Value> {
  if (value === undefined) {
    return [];
  }
  return isList(value) ? value : [value];
}

function isList<Value>(value: Value | ReadonlyArray<Value>): value is ReadonlyArray<Value> {
  return Array.isArray(value);
}
