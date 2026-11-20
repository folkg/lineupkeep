import * as Shared from "@lineupkeep/machine-test";
import { Arbitrary, Data, Effect, Result, Schema } from "effect";

import { type DefinedMachine, plan, snapshotOf, type Tagged } from "#utilities/machine.ts";

export type TestSnapshot<State extends Tagged> = Shared.TestSnapshot<State>;
export type Invariant<State extends Tagged, Event extends Tagged> = Shared.Invariant<State, Event>;
export type Trace<State extends Tagged, Event extends Tagged> = Shared.Trace<State, Event>;
export type Exploration<State extends Tagged> = Shared.Exploration<State>;

export class MachineTestFailure extends Data.TaggedError("MachineTestFailure")<{
  readonly detail: string;
}> {}

export function invariants<State extends Tagged, Event extends Tagged>(
  _machine: DefinedMachine<State, Event>,
): ReturnType<typeof Shared.invariants<State, Event>> {
  return Shared.invariants<State, Event>();
}

export function run<State extends Tagged, Event extends Tagged>(
  machine: DefinedMachine<State, Event>,
  scenario: { readonly input: NoInfer<State>; readonly events: ReadonlyArray<NoInfer<Event>> },
): Effect.Effect<Trace<State, Event>, Schema.SchemaError> {
  return Effect.try({
    try: () =>
      Shared.run(
        adapter(
          machine,
          () => "",
          () => [],
        ),
        scenario,
      ),
    catch: (cause) => {
      if (cause instanceof Schema.SchemaError) {
        return cause;
      }
      throw cause;
    },
  });
}

export function verify<State extends Tagged, Event extends Tagged>(
  machine: DefinedMachine<State, Event>,
  trace: Trace<NoInfer<State>, NoInfer<Event>>,
): Effect.Effect<void, MachineTestFailure> {
  return failureEffect(() =>
    Shared.verify(
      adapter(
        machine,
        () => "",
        () => [],
      ),
      trace,
    ),
  );
}

export function checkInvariants<State extends Tagged, Event extends Tagged>(
  machine: DefinedMachine<State, Event>,
  trace: Trace<NoInfer<State>, NoInfer<Event>>,
  invariants: ReadonlyArray<Invariant<NoInfer<State>, NoInfer<Event>>>,
): Effect.Effect<void, MachineTestFailure> {
  return failureEffect(() =>
    Shared.checkInvariants(
      adapter(
        machine,
        () => "",
        () => [],
      ),
      trace,
      invariants,
    ),
  );
}

export function explore<State extends Tagged, Event extends Tagged>(
  machine: DefinedMachine<State, Event>,
  options: {
    readonly input: NoInfer<State>;
    readonly events: (context: {
      readonly snapshot: TestSnapshot<NoInfer<State>>;
    }) => ReadonlyArray<NoInfer<Event>>;
    readonly stateKey: (context: { readonly snapshot: TestSnapshot<NoInfer<State>> }) => string;
    readonly invariants?: ReadonlyArray<Invariant<NoInfer<State>, NoInfer<Event>>>;
  },
): Effect.Effect<Exploration<State>, MachineTestFailure | Schema.SchemaError> {
  return failureEffect(
    () =>
      Shared.explore(
        adapter(
          machine,
          (state) => options.stateKey({ snapshot: { state: { path: state._tag, value: state } } }),
          (state) => options.events({ snapshot: { state: { path: state._tag, value: state } } }),
        ),
        options,
      ),
    true,
  );
}

export function scenarios<State extends Tagged, Event extends Tagged, Input>(
  _machine: DefinedMachine<State, Event>,
  options: {
    readonly inputArbitrary: Arbitrary.Arbitrary<Input>;
    readonly eventsArbitrary: Arbitrary.Arbitrary<ReadonlyArray<NoInfer<Event>>>;
  },
): {
  readonly arbitrary: Arbitrary.Arbitrary<{
    readonly input: Input;
    readonly events: ReadonlyArray<Event>;
  }>;
} {
  return {
    arbitrary: Arbitrary.all([options.inputArbitrary, options.eventsArbitrary]).pipe(
      Arbitrary.map(([input, events]) => ({ input, events })),
    ),
  };
}

function adapter<State extends Tagged, Event extends Tagged>(
  machine: DefinedMachine<State, Event>,
  stateKey: (state: State) => string,
  events: (state: State) => ReadonlyArray<Event>,
): Shared.MachineAdapter<State, Event> {
  const declarations = Object.keys(machine.definition.states).flatMap((from) =>
    Object.entries(machine.transitionsOf(from)).flatMap(([event, specification]) =>
      listOf(specification).map((_candidate, index) => ({
        id: `${from}.${event}.${index}`,
        from,
        event,
      })),
    ),
  );
  const candidate = (
    state: State,
    event: Event,
  ): { readonly id: string; readonly target: string } | undefined => {
    const candidates = listOf(machine.transitionsOf(state._tag)[event._tag]);
    const index = candidates.findIndex(
      (entry) => entry.guard === undefined || entry.guard({ state, event }),
    );
    const entry = candidates[index];
    return entry === undefined
      ? undefined
      : { id: `${state._tag}.${event._tag}.${index}`, target: entry.target };
  };
  return {
    statePath: (state) => state._tag,
    stateKey,
    events,
    eventName: (event) => event._tag,
    isFinal: (state) => {
      const entry = machine.definition.root[state._tag];
      if (entry === undefined) {
        throw new Error(`The machine has no state named ${state._tag}`);
      }
      return "final" in entry;
    },
    declarations,
    transitionId: (state, event) => candidate(state, event)?.id,
    expectedTarget: (state, event) => candidate(state, event)?.target,
    transition: (state, event) => {
      const result = Effect.runSync(
        Effect.result(
          Effect.flatMap(snapshotOf(machine, state), (snapshot) => plan(machine, snapshot, event)),
        ),
      );
      if (Result.isSuccess(result)) {
        return result.success;
      }
      if (result.failure._tag === "TransitionRejected") {
        return undefined;
      }
      throw result.failure;
    },
  };
}

function failureEffect<A>(run: () => A): Effect.Effect<A, MachineTestFailure>;
function failureEffect<A>(
  run: () => A,
  schema: true,
): Effect.Effect<A, MachineTestFailure | Schema.SchemaError>;
function failureEffect<A>(
  run: () => A,
  schema?: true,
): Effect.Effect<A, MachineTestFailure | Schema.SchemaError> {
  return Effect.try({
    try: run,
    catch: (cause) => {
      if (cause instanceof Shared.MachineTestFailure) {
        return new MachineTestFailure({ detail: cause.detail });
      }
      if (schema === true && cause instanceof Schema.SchemaError) {
        return cause;
      }
      throw cause;
    },
  });
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
