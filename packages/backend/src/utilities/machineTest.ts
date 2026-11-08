import { Arbitrary, Data, Effect, Option, Schema } from "effect";

import {
  type DefinedMachine,
  plan,
  type Snapshot,
  snapshotOf,
  type Tagged,
} from "#utilities/machine.ts";

export type TestSnapshot<State extends Tagged> = {
  readonly state: { readonly path: string; readonly value: State };
};

export type Invariant<State extends Tagged, Event extends Tagged> =
  | {
      readonly _tag: "StateInvariant";
      readonly name: string;
      readonly check: (args: { readonly snapshot: TestSnapshot<State> }) => boolean;
    }
  | {
      readonly _tag: "StepInvariant";
      readonly name: string;
      readonly check: (args: {
        readonly before: TestSnapshot<State>;
        readonly after: TestSnapshot<State>;
        readonly event: Event;
      }) => boolean;
    };

export type Trace<State extends Tagged, Event extends Tagged> = {
  readonly input: TestSnapshot<State>;
  readonly steps: ReadonlyArray<{
    readonly before: TestSnapshot<State>;
    readonly after: TestSnapshot<State>;
    readonly event: Event;
    readonly accepted: boolean;
  }>;
  readonly final: TestSnapshot<State>;
};

export type Exploration<State extends Tagged> = {
  readonly completeness: { readonly _tag: "Complete" };
  readonly nodes: ReadonlyArray<{ readonly snapshot: TestSnapshot<State> }>;
  readonly transitionCoverage: {
    readonly definitions: { readonly missing: number };
    readonly branches: { readonly missing: number };
  };
};

export class MachineTestFailure extends Data.TaggedError("MachineTestFailure")<{
  readonly detail: string;
}> {}

export function invariants<State extends Tagged, Event extends Tagged>(
  _machine: DefinedMachine<State, Event>,
): {
  readonly state: (
    name: string,
    check: (args: { readonly snapshot: TestSnapshot<NoInfer<State>> }) => boolean,
  ) => Invariant<State, Event>;
  readonly step: (
    name: string,
    check: (args: {
      readonly before: TestSnapshot<NoInfer<State>>;
      readonly after: TestSnapshot<NoInfer<State>>;
      readonly event: NoInfer<Event>;
    }) => boolean,
  ) => Invariant<State, Event>;
} {
  return {
    state: (name, check) => ({ _tag: "StateInvariant", name, check }),
    step: (name, check) => ({ _tag: "StepInvariant", name, check }),
  };
}

export function run<State extends Tagged, Event extends Tagged>(
  machine: DefinedMachine<State, Event>,
  scenario: {
    readonly input: NoInfer<State>;
    readonly events: ReadonlyArray<NoInfer<Event>>;
  },
): Effect.Effect<Trace<State, Event>, Schema.SchemaError> {
  return Effect.gen(function* () {
    const steps: Array<Trace<State, Event>["steps"][number]> = [];
    let current = scenario.input;
    for (const event of scenario.events) {
      const snapshot = yield* snapshotOf(machine, current);
      const next = yield* attempt(machine, snapshot, event);
      const accepted = Option.isSome(next);
      steps.push({
        before: view(current),
        after: view(accepted ? next.value : current),
        event,
        accepted,
      });
      current = accepted ? next.value : current;
    }
    return { input: view(scenario.input), steps, final: view(current) };
  });
}

export function verify<State extends Tagged, Event extends Tagged>(
  machine: DefinedMachine<State, Event>,
  trace: Trace<NoInfer<State>, NoInfer<Event>>,
): Effect.Effect<void, MachineTestFailure> {
  return Effect.gen(function* () {
    for (const step of trace.steps) {
      if (!step.accepted) {
        continue;
      }
      const candidate = firstPassingCandidate(machine, step.before.state.value, step.event);
      if (candidate === undefined || candidate.target !== step.after.state.path) {
        return yield* new MachineTestFailure({
          detail: `The trace accepted ${step.event._tag} from ${step.before.state.path} into ${step.after.state.path}, but the machine does not declare that transition`,
        });
      }
    }
  });
}

export function checkInvariants<State extends Tagged, Event extends Tagged>(
  _machine: DefinedMachine<State, Event>,
  trace: Trace<NoInfer<State>, NoInfer<Event>>,
  invariants: ReadonlyArray<Invariant<NoInfer<State>, NoInfer<Event>>>,
): Effect.Effect<void, MachineTestFailure> {
  return Effect.gen(function* () {
    for (const invariant of invariants) {
      if (invariant._tag === "StateInvariant") {
        yield* checkState(invariant, trace.input);
        for (const step of trace.steps) {
          yield* checkState(invariant, step.after);
        }
        continue;
      }
      for (const step of trace.steps) {
        if (!invariant.check({ before: step.before, after: step.after, event: step.event })) {
          return yield* new MachineTestFailure({
            detail: `Machine invariant "${invariant.name}" failed after ${step.event._tag} from ${step.before.state.path}`,
          });
        }
      }
    }
  });
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
  return Effect.gen(function* () {
    const queue: Array<State> = [options.input];
    const nodes: Array<{ readonly snapshot: TestSnapshot<State> }> = [
      { snapshot: view(options.input) },
    ];
    const seen = new Set([options.stateKey({ snapshot: view(options.input) })]);
    const taken = new Set<string>();
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor];
      if (current === undefined) {
        continue;
      }
      const snapshot = yield* snapshotOf(machine, current);
      for (const event of options.events({ snapshot: view(current) })) {
        const next = yield* attempt(machine, snapshot, event);
        const accepted = Option.isSome(next);
        yield* checkStep(options, current, accepted ? next.value : current, event);
        if (!accepted) {
          continue;
        }
        const candidate = firstPassingCandidate(machine, current, event);
        if (candidate === undefined) {
          return yield* new MachineTestFailure({
            detail: `The machine accepted ${event._tag} from ${current._tag} without a declaration`,
          });
        }
        taken.add(candidate.id);
        const key = options.stateKey({ snapshot: view(next.value) });
        if (!seen.has(key)) {
          seen.add(key);
          queue.push(next.value);
          nodes.push({ snapshot: view(next.value) });
        }
      }
    }
    const missing = declaredCandidates(machine).filter(
      (candidate) => !taken.has(candidate.id),
    ).length;
    return {
      completeness: { _tag: "Complete" },
      nodes,
      transitionCoverage: { definitions: { missing }, branches: { missing } },
    };
  });
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

function view<State extends Tagged>(state: State): TestSnapshot<State> {
  return { state: { path: state._tag, value: state } };
}

function attempt<State extends Tagged, Event extends Tagged>(
  machine: DefinedMachine<State, Event>,
  snapshot: Snapshot<State>,
  event: Event,
): Effect.Effect<Option.Option<State>, Schema.SchemaError> {
  return plan(machine, snapshot, event).pipe(
    Effect.map(Option.some),
    Effect.catchTag("TransitionRejected", () => Effect.succeed(Option.none())),
  );
}

function checkState<State extends Tagged, Event extends Tagged>(
  invariant: Invariant<State, Event>,
  snapshot: TestSnapshot<State>,
): Effect.Effect<void, MachineTestFailure> {
  if (invariant._tag !== "StateInvariant") {
    return Effect.void;
  }
  return invariant.check({ snapshot })
    ? Effect.void
    : Effect.fail(
        new MachineTestFailure({
          detail: `Machine invariant "${invariant.name}" failed in ${snapshot.state.path}`,
        }),
      );
}

function checkStep<State extends Tagged, Event extends Tagged>(
  options: { readonly invariants?: ReadonlyArray<Invariant<State, Event>> },
  before: State,
  after: State,
  event: Event,
): Effect.Effect<void, MachineTestFailure> {
  return Effect.gen(function* () {
    for (const invariant of options.invariants ?? []) {
      if (invariant._tag === "StateInvariant") {
        yield* checkState(invariant, view(after));
        continue;
      }
      if (!invariant.check({ before: view(before), after: view(after), event })) {
        return yield* new MachineTestFailure({
          detail: `Machine invariant "${invariant.name}" failed after ${event._tag} from ${before._tag}`,
        });
      }
    }
  });
}

function declaredCandidates<State extends Tagged, Event extends Tagged>(
  machine: DefinedMachine<State, Event>,
): ReadonlyArray<{ readonly id: string }> {
  const ids: Array<{ readonly id: string }> = [];
  for (const from of Object.keys(machine.definition.states)) {
    for (const [on, specification] of Object.entries(machine.transitionsOf(from))) {
      const candidates = listOf(specification);
      candidates.forEach((_candidate, index) => ids.push({ id: `${from}.${on}.${index}` }));
    }
  }
  return ids;
}

function firstPassingCandidate<State extends Tagged, Event extends Tagged>(
  machine: DefinedMachine<State, Event>,
  state: State,
  event: Event,
): { readonly id: string; readonly target: string } | undefined {
  const specification = machine.transitionsOf(state._tag)[event._tag];
  const candidates = listOf(specification);
  const index = candidates.findIndex(
    (candidate) => candidate.guard === undefined || candidate.guard({ state, event }),
  );
  const candidate = index === -1 ? undefined : candidates[index];
  return candidate === undefined
    ? undefined
    : { id: `${state._tag}.${event._tag}.${index}`, target: candidate.target };
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
