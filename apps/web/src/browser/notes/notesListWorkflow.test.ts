import * as fc from "fast-check";
import { expect, it } from "vitest";

import { exploreWorkflow, play } from "#browser/workflow/workflowTest.ts";
import type { NoteView } from "#contracts/notes/noteContract.ts";

import { notesListWorkflow } from "./notesListWorkflow";

const invariants = {
  "one collection change at a time": (state: State, previous: State, event: Event | undefined) => {
    if (previous.value === "changing" && (event?.type === "change" || event?.type === "undo")) {
      expect(state).toEqual(previous);
    }
  },
  "undo only follows confirmed trash": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (event?.type === "undo" && previous.value === "ready") {
      if (
        previous.context.outcome?.type === "confirmed" &&
        previous.context.outcome.change.kind === "trash"
      ) {
        expect(state.value === "changing" && state.context.change).toEqual({
          kind: "undo",
          note: previous.context.outcome.change.note,
        });
      } else {
        expect(state).toEqual(previous);
      }
    }
  },
  "outcomes retain the affected note": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (
      previous.value === "changing" &&
      (event?.type === "confirmed" || event?.type === "failed")
    ) {
      expect(state.context.outcome).toMatchObject({
        type: event.type,
        change: previous.context.change,
      });
      if (event.type === "failed") {
        expect(state.context.outcome).toMatchObject({ failure: event.failure });
      }
    }
  },
  "editors remain independently retained": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    const expected = new Map(previous.context.retained.map((note) => [note.id, note]));
    if (event?.type === "editingChanged") {
      if (event.note === undefined) {
        expected.delete(event.id);
      } else {
        expected.set(event.id, event.note);
      }
    }

    const retained = state.context.retained;
    expect(new Set(retained.map((note) => note.id)).size).toBe(retained.length);
    expect(retained).toHaveLength(expected.size);
    for (const note of retained) {
      expect(note).toEqual(expected.get(note.id));
    }
  },
};

it("explores every collection transition with ownership and recovery invariants", () => {
  exploreWorkflow(notesListWorkflow, { events, invariants });
});

it.each(Object.entries(invariants))(
  "preserves %s across generated collection events",
  (_name, invariant) => {
    fc.assert(
      fc.property(fc.array(generatedEvent, { maxLength: 100 }), (sequence) => {
        play(notesListWorkflow, sequence, undefined, { invariant });
      }),
      { seed: 20261021, numRuns: 100 },
    );
  },
);

const first = makeNote("note-1", "First");
const second = makeNote("note-2", "Second");
const events: ReadonlyArray<Event> = [
  ...(["trash", "restore", "delete"] as const).map((kind) => ({
    type: "change" as const,
    kind,
    note: first,
  })),
  { type: "undo" },
  { type: "confirmed" },
  { type: "failed", failure: { kind: "unconfirmed", message: "Unconfirmed" } },
  { type: "failed", failure: { kind: "rejected", message: "Rejected" } },
  { type: "checkLatest" },
  { type: "refreshed" },
  { type: "refreshFailed" },
  { type: "editingChanged", id: first.id, note: first },
  { type: "editingChanged", id: first.id, note: undefined },
];
const generatedNote = fc
  .record({
    id: fc.uuid(),
    title: fc.string({ unit: "grapheme", maxLength: 200 }),
    body: fc.string({ unit: "grapheme", maxLength: 220 }),
  })
  .map(({ id, title, body }) => ({ ...first, id, title, body }));
const generatedEvent: fc.Arbitrary<Event> = fc.oneof(
  fc.constantFrom(...events, { type: "editingChanged" as const, id: second.id, note: second }),
  fc.record({
    type: fc.constant("change" as const),
    kind: fc.constantFrom("trash" as const, "restore" as const, "delete" as const),
    note: generatedNote,
  }),
  generatedNote.map((note) => ({ type: "editingChanged" as const, id: note.id, note })),
);

function makeNote(id: string, title: string): NoteView {
  return {
    id,
    title,
    body: "Body",
    lifecycle: "active",
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
  };
}

type State = typeof notesListWorkflow.initialState;
type Event = Parameters<typeof notesListWorkflow.transition>[1];
