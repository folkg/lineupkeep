export type TestSnapshot<State> = {
  readonly state: { readonly path: string; readonly value: State };
};

export type Invariant<State, Event> =
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

export type Trace<State, Event> = {
  readonly input: TestSnapshot<State>;
  readonly steps: ReadonlyArray<{
    readonly before: TestSnapshot<State>;
    readonly after: TestSnapshot<State>;
    readonly event: Event;
    readonly accepted: boolean;
  }>;
  readonly final: TestSnapshot<State>;
};

export type Exploration<State> = {
  readonly completeness: { readonly _tag: "Complete" };
  readonly nodes: ReadonlyArray<{ readonly snapshot: TestSnapshot<State> }>;
  readonly transitionCoverage: {
    readonly definitions: { readonly missing: number };
    readonly branches: { readonly missing: number };
    readonly uncovered: ReadonlyArray<string>;
  };
};

export class MachineTestFailure extends Error {
  readonly _tag = "MachineTestFailure";

  constructor(readonly detail: string) {
    super(detail);
  }
}

export type MachineAdapter<State, Event> = {
  readonly statePath: (state: State) => string;
  readonly stateKey: (state: State) => string;
  readonly transition: (state: State, event: Event) => State | undefined;
  readonly events: (state: State) => ReadonlyArray<Event>;
  readonly eventName: (event: Event) => string;
  readonly isFinal: (state: State) => boolean;
  readonly declarations: ReadonlyArray<{
    readonly id: string;
    readonly from: string;
    readonly event: string;
  }>;
  readonly transitionId: (state: State, event: Event) => string | undefined;
  readonly expectedTarget: (state: State, event: Event) => string | undefined;
};

export function invariants<State, Event>(): {
  readonly state: (
    name: string,
    check: (args: { readonly snapshot: TestSnapshot<State> }) => boolean,
  ) => Invariant<State, Event>;
  readonly step: (
    name: string,
    check: (args: {
      readonly before: TestSnapshot<State>;
      readonly after: TestSnapshot<State>;
      readonly event: Event;
    }) => boolean,
  ) => Invariant<State, Event>;
} {
  return {
    state: (name, check) => ({ _tag: "StateInvariant", name, check }),
    step: (name, check) => ({ _tag: "StepInvariant", name, check }),
  };
}

export function run<State, Event>(
  adapter: MachineAdapter<State, Event>,
  scenario: { readonly input: NoInfer<State>; readonly events: ReadonlyArray<NoInfer<Event>> },
): Trace<State, Event> {
  const steps: Array<Trace<State, Event>["steps"][number]> = [];
  let current = scenario.input;
  for (const event of scenario.events) {
    const next = adapter.transition(current, event);
    steps.push({
      before: view(adapter, current),
      after: view(adapter, next ?? current),
      event,
      accepted: next !== undefined,
    });
    current = next ?? current;
  }
  return { input: view(adapter, scenario.input), steps, final: view(adapter, current) };
}

export function verify<State, Event>(
  adapter: MachineAdapter<State, Event>,
  trace: Trace<State, Event>,
): void {
  const declared = new Map(
    adapter.declarations.map((declaration) => [declaration.id, declaration]),
  );
  for (const step of trace.steps) {
    if (!step.accepted) {
      continue;
    }
    const id = adapter.transitionId(step.before.state.value, step.event);
    const declaration = id === undefined ? undefined : declared.get(id);
    if (
      declaration === undefined ||
      declaration.from !== step.before.state.path ||
      declaration.event !== adapter.eventName(step.event) ||
      adapter.expectedTarget(step.before.state.value, step.event) !== step.after.state.path
    ) {
      throw new MachineTestFailure(
        `The trace accepted ${adapter.eventName(step.event)} from ${step.before.state.path} into ${step.after.state.path}, but the machine does not declare that transition`,
      );
    }
  }
}

export function checkInvariants<State, Event>(
  adapter: MachineAdapter<State, Event>,
  trace: Trace<State, Event>,
  checks: ReadonlyArray<Invariant<State, Event>>,
): void {
  for (const invariant of checks) {
    if (invariant._tag === "StateInvariant") {
      checkState(invariant, trace.input);
      for (const step of trace.steps) {
        checkState(invariant, step.after);
      }
      continue;
    }
    for (const step of trace.steps) {
      checkStep(adapter, invariant, step.before, step.after, step.event);
    }
  }
}

export function explore<State, Event>(
  adapter: MachineAdapter<State, Event>,
  options: {
    readonly input: NoInfer<State>;
    readonly invariants?: ReadonlyArray<Invariant<State, Event>>;
  },
): Exploration<State> {
  for (const invariant of options.invariants ?? []) {
    checkState(invariant, view(adapter, options.input));
  }
  const queue: Array<{ readonly state: State; readonly path: ReadonlyArray<string> }> = [
    { state: options.input, path: [] },
  ];
  const nodes: Array<{ readonly snapshot: TestSnapshot<State> }> = [
    { snapshot: view(adapter, options.input) },
  ];
  const seen = new Set([adapter.stateKey(options.input)]);
  const declared = new Map(
    adapter.declarations.map((declaration) => [declaration.id, declaration]),
  );
  const taken = new Set<string>();
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const entry = queue[cursor];
    if (entry === undefined) {
      continue;
    }
    const { state: current, path } = entry;
    for (const event of adapter.events(current)) {
      const next = adapter.transition(current, event);
      const name = adapter.eventName(event);
      if (next !== undefined && adapter.isFinal(current)) {
        throw new MachineTestFailure(`Final state ${adapter.statePath(current)} accepted ${name}`);
      }
      const after = next ?? current;
      const prefix = [...path, name].join(" -> ");
      try {
        for (const invariant of options.invariants ?? []) {
          if (invariant._tag === "StateInvariant") {
            checkState(invariant, view(adapter, after));
          } else {
            checkStep(adapter, invariant, view(adapter, current), view(adapter, after), event);
          }
        }
      } catch (cause) {
        if (cause instanceof MachineTestFailure) {
          throw new MachineTestFailure(`${cause.detail}; path: ${prefix}`);
        }
        throw cause;
      }
      if (next === undefined) {
        continue;
      }
      const id = adapter.transitionId(current, event);
      const declaration = id === undefined ? undefined : declared.get(id);
      if (
        declaration === undefined ||
        declaration.from !== adapter.statePath(current) ||
        declaration.event !== name
      ) {
        throw new MachineTestFailure(
          `The machine accepted ${name} from ${adapter.statePath(current)} without a declaration`,
        );
      }
      taken.add(declaration.id);
      const key = adapter.stateKey(next);
      if (!seen.has(key)) {
        seen.add(key);
        queue.push({ state: next, path: [...path, name] });
        nodes.push({ snapshot: view(adapter, next) });
      }
    }
  }
  const uncovered = adapter.declarations.filter(({ id }) => !taken.has(id)).map(({ id }) => id);
  const missing = uncovered.length;
  return {
    completeness: { _tag: "Complete" },
    nodes,
    transitionCoverage: { definitions: { missing }, branches: { missing }, uncovered },
  };
}

function view<State, Event>(
  adapter: MachineAdapter<State, Event>,
  state: State,
): TestSnapshot<State> {
  return { state: { path: adapter.statePath(state), value: state } };
}

function checkState<State, Event>(
  invariant: Invariant<State, Event>,
  snapshot: TestSnapshot<State>,
): void {
  if (invariant._tag === "StateInvariant" && !invariant.check({ snapshot })) {
    throw new MachineTestFailure(
      `Machine invariant "${invariant.name}" failed in ${snapshot.state.path}`,
    );
  }
}

function checkStep<State, Event>(
  adapter: MachineAdapter<State, Event>,
  invariant: Invariant<State, Event>,
  before: TestSnapshot<State>,
  after: TestSnapshot<State>,
  event: Event,
): void {
  if (invariant._tag === "StepInvariant" && !invariant.check({ before, after, event })) {
    throw new MachineTestFailure(
      `Machine invariant "${invariant.name}" failed after ${adapter.eventName(event)} from ${before.state.path}`,
    );
  }
}
