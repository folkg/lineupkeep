import { Machine } from "@typeonce/effect-machine";
import { Data, Effect, Equal, Schema } from "effect";

export function snapshotOf<
  States extends Machine.Machine.StateSchemas,
  Events extends ReadonlyArray<Machine.Machine.TaggedSchema>,
  Emits extends ReadonlyArray<Machine.Machine.TaggedSchema>,
  Input extends Schema.Top,
  Unhandled extends Machine.Machine.StateIdentifier<States>,
  E,
  R,
  InitialE,
  InitialR,
  Final extends Machine.Machine.StateIdentifier<States>,
  Output,
  OutputStates extends Machine.Machine.StateIdentifier<States>,
  InputEvents extends ReadonlyArray<Machine.Machine.TaggedSchema>,
  ParentEvents extends ReadonlyArray<Machine.Machine.TaggedSchema>,
  State extends { readonly _tag: string },
>(
  machine: Machine.Machine<
    States,
    Events,
    Input,
    Unhandled,
    E,
    R,
    InitialE,
    InitialR,
    Final,
    Output,
    Emits,
    OutputStates,
    InputEvents,
    ParentEvents
  >,
  state: State,
): Effect.Effect<
  Machine.Machine.Snapshot<States>,
  Machine.MachineSchemaDecodeError | Schema.SchemaError,
  | Machine.Machine.SnapshotDecodingServices<States>
  | Machine.Machine.SchemaByIdentifier<
      States,
      Machine.Machine.ValuedStateIdentifier<States>
    >["EncodingServices"]
> {
  return Effect.gen(function* () {
    const node = Machine.stateNodes(machine).find((node) => node.path === state._tag);
    if (
      node === undefined ||
      node.path.includes(".") ||
      node.schema === undefined ||
      (node.type !== "atomic" && node.type !== "final")
    ) {
      return yield* Effect.die(
        "snapshotOf needs a top-level state with a schema; use decodeSnapshot for nested configurations",
      );
    }
    const schema = Schema.make<
      Schema.Codec<
        unknown,
        unknown,
        never,
        Machine.Machine.SchemaByIdentifier<
          States,
          Machine.Machine.ValuedStateIdentifier<States>
        >["EncodingServices"]
      >
    >(node.schema.ast);
    const value = yield* Schema.encodeUnknownEffect(Schema.toCodecJson(schema))(state);
    const encoded: Machine.Machine.EncodedSnapshot = {
      _tag: "MachineSnapshot",
      version: 2,
      active: node.path === "" ? [{ path: "", value }] : [{ path: "" }, { path: node.path, value }],
      ...(node.type === "final"
        ? { completed: node.path === "" ? [{ path: "" }] : [{ path: node.path }, { path: "" }] }
        : {}),
    };
    return yield* Machine.decodeSnapshot(machine, encoded);
  });
}

export function planBatch<
  States extends Machine.Machine.StateSchemas,
  Events extends ReadonlyArray<Machine.Machine.TaggedSchema>,
  Emits extends ReadonlyArray<Machine.Machine.TaggedSchema>,
  Input extends Schema.Top,
  E,
  R,
  InitialE,
  InitialR,
  Final extends Machine.Machine.StateIdentifier<States>,
  Output,
  InputEvents extends ReadonlyArray<Machine.Machine.TaggedSchema>,
  Id,
  Row extends { readonly id: Id } & (
    | { readonly input: Machine.Machine.InputArgs<Input> }
    | { readonly snapshot: Machine.Machine.Snapshot<States> }
  ),
>(
  machine: Parameters<
    typeof Machine.plan<
      States,
      Events,
      Emits,
      Input,
      never,
      E,
      R,
      InitialE,
      InitialR,
      Final,
      Output,
      never,
      InputEvents
    >
  >[0],
  rows: ReadonlyArray<Row>,
  event:
    | Machine.Machine.EventInputOf<InputEvents>
    | ((row: Row) => Machine.Machine.EventInputOf<InputEvents>),
): Effect.Effect<
  ReadonlyArray<{
    readonly id: Row["id"];
    readonly row: Row;
    readonly snapshot: Machine.Machine.Snapshot<States>;
  }>,
  | E
  | InitialE
  | Machine.InfiniteTransitionError
  | Machine.MachineSchemaDecodeError
  | Machine.StartupError
  | TransitionRejected<
      Row["id"],
      Machine.Machine.Snapshot<States>,
      Machine.Machine.EventOf<InputEvents>
    >
> {
  return Effect.gen(function* () {
    const changes: Array<{
      readonly id: Row["id"];
      readonly row: Row;
      readonly snapshot: Machine.Machine.Snapshot<States>;
    }> = [];
    for (const row of rows) {
      const initial =
        "input" in row ? (yield* Machine.planInitial(machine, ...row.input)).state : row.snapshot;
      const request = typeof event === "function" ? event(row) : event;
      const planned = yield* Machine.plan(machine, initial, request);
      const handled = planned.microsteps.some((step) => step.transitions.length > 0);
      if (!handled) {
        return yield* new TransitionRejected({
          id: row.id,
          state: initial,
          event: planned.event,
        });
      }
      if (!Equal.equals(initial, planned.next)) {
        changes.push({ id: row.id, row, snapshot: planned.next });
      }
    }
    return changes;
  });
}

export class TransitionRejected<Id, State, Event> extends Data.TaggedError("TransitionRejected")<{
  readonly id: Id;
  readonly state: State;
  readonly event: Event;
}> {}
