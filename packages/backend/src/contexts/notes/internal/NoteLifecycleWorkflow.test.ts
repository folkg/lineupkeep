import { assert, it } from "@effect/vitest";
import { Machine } from "@typeonce/effect-machine";
import { MachineTest } from "@typeonce/effect-machine/testing";
import { Arbitrary, DateTime, Effect, Schema } from "effect";

import { decodeNoteTitle, decodeNoteBody } from "#contexts/notes/Note.ts";

import { NoteLifecycleWorkflow, NoteLifecycleState } from "./NoteLifecycleWorkflow.ts";
import type { NoteLifecycleRequest } from "./NoteLifecycleWorkflow.ts";

const define = MachineTest.invariants(NoteLifecycleWorkflow);
const invariants = [
  define.state(
    "only Trashed owns trashedAt",
    ({ snapshot }) => "trashedAt" in snapshot.state.value === (snapshot.state.path === "Trashed"),
  ),
  define.state(
    "only Deleted owns deletedAt",
    ({ snapshot }) => "deletedAt" in snapshot.state.value === (snapshot.state.path === "Deleted"),
  ),
  define.step(
    "lifecycle changes preserve content",
    ({ before, after, event }) =>
      (before.state.path === "Active" && event._tag === "EditRequested") ||
      (before.state.value.title === after.state.value.title &&
        before.state.value.body === after.state.value.body),
  ),
  define.step(
    "accepted changes timestamp the event and no-ops retain updatedAt",
    ({ before, after, event }) => {
      const changes =
        (before.state.path === "Active" &&
          (event._tag === "EditRequested" || event._tag === "TrashRequested")) ||
        (before.state.path === "Trashed" &&
          (event._tag === "RestoreRequested" || event._tag === "DeleteRequested"));
      return DateTime.Equivalence(
        after.state.value.updatedAt,
        changes ? event.at : before.state.value.updatedAt,
      );
    },
  ),
  define.step(
    "deletion captures its event timestamp",
    ({ before, after, event }) =>
      before.state.path !== "Trashed" ||
      event._tag !== "DeleteRequested" ||
      (after.state.value._tag === "Deleted" &&
        DateTime.Equivalence(after.state.value.deletedAt, event.at)),
  ),
  define.step(
    "active edits capture the event data",
    ({ before, after, event }) =>
      before.state.path !== "Active" ||
      event._tag !== "EditRequested" ||
      (after.state.value._tag === "Active" &&
        after.state.value.title === event.title &&
        after.state.value.body === event.body &&
        DateTime.Equivalence(after.state.value.updatedAt, event.at)),
  ),
  define.state("Deleted is terminal and accepts no event", ({ snapshot }) => {
    if (snapshot.state.path !== "Deleted") {
      return true;
    }
    return [edit, trash, restore, remove].every((event: NoteLifecycleRequest) => {
      const planned = Effect.runSync(Machine.plan(NoteLifecycleWorkflow, snapshot, event));
      return (
        planned.microsteps.every((step) => step.transitions.length === 0) &&
        Schema.toEquivalence(NoteLifecycleState)(planned.next.state.value, snapshot.state.value)
      );
    });
  }),
];

it.effect("explores every lifecycle transition without retaining startup data", () =>
  Effect.gen(function* () {
    const explored = yield* MachineTest.explore(NoteLifecycleWorkflow, {
      input,
      events: () => [edit, trash, restore, remove],
      stateKey: ({ snapshot }) => snapshot.state.path,
      invariants,
    });

    assert.strictEqual(explored.completeness._tag, "Complete");
    assert.strictEqual(explored.transitionCoverage.definitions.missing, 0);
    assert.strictEqual(explored.transitionCoverage.branches.missing, 0);
  }),
);

it.effect.each(invariants)("preserves $name across generated scenarios", (invariant) =>
  Effect.gen(function* () {
    const values = Arbitrary.schema(
      Schema.Struct({
        title: Schema.String.check(Schema.isMaxLength(199)),
        body: Schema.String.check(Schema.isMaxLength(9999)),
        millis: Schema.Int.check(
          Schema.isBetween({ minimum: -8_640_000_000_000_000, maximum: 8_640_000_000_000_000 }),
        ),
        kind: Schema.Literals([
          "EditRequested",
          "TrashRequested",
          "RestoreRequested",
          "DeleteRequested",
        ]),
      }),
    ).pipe(
      Arbitrary.map(({ title, body, millis, kind }) => ({
        title: decodeNoteTitle(`題${title}`),
        body: decodeNoteBody(`文${body}`),
        at: DateTime.makeUnsafe(millis),
        kind,
      })),
    );
    const generated = MachineTest.scenarios(NoteLifecycleWorkflow, {
      inputArbitrary: values.pipe(
        Arbitrary.map(({ title, body, at }) => ({
          _tag: "Active" as const,
          title,
          body,
          updatedAt: at,
        })),
      ),
      eventsArbitrary: Arbitrary.array(
        values.pipe(
          Arbitrary.map(({ title, body, at, kind }): NoteLifecycleRequest =>
            kind === "EditRequested" ? { _tag: kind, title, body, at } : { _tag: kind, at },
          ),
        ),
        { maxLength: 50 },
      ),
    });
    const result = yield* Arbitrary.checkEffect(
      generated.arbitrary,
      (scenario) =>
        Effect.gen(function* () {
          const trace = yield* MachineTest.run(NoteLifecycleWorkflow, scenario);
          yield* MachineTest.verify(NoteLifecycleWorkflow, trace);
          yield* MachineTest.checkInvariants(NoteLifecycleWorkflow, trace, [invariant]);
          return true;
        }),
      { seed: 20261021, runs: 100 },
    );

    assert.strictEqual(result._tag, "Passed", Arbitrary.formatCheckFailure(result));
  }),
);

const at = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
const input = {
  _tag: "Active" as const,
  title: decodeNoteTitle("Title"),
  body: decodeNoteBody("Body"),
  updatedAt: at,
};
const edit = {
  _tag: "EditRequested" as const,
  title: decodeNoteTitle("Changed"),
  body: input.body,
  at: DateTime.makeUnsafe("2026-01-02T00:00:00Z"),
};
const trash = { _tag: "TrashRequested" as const, at: DateTime.makeUnsafe("2026-01-03T00:00:00Z") };
const restore = {
  _tag: "RestoreRequested" as const,
  at: DateTime.makeUnsafe("2026-01-04T00:00:00Z"),
};
const remove = {
  _tag: "DeleteRequested" as const,
  at: DateTime.makeUnsafe("2026-01-05T00:00:00Z"),
};
