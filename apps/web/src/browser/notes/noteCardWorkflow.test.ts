import * as fc from "fast-check";
import { expect, it } from "vitest";

import { exploreWorkflow, play } from "#browser/workflow/workflowTest.ts";
import type { NoteView } from "#contracts/notes/noteContract.ts";

import { noteCardWorkflow } from "./noteCardWorkflow";
import { noteTitleError, noteBodyError } from "./noteInput";

const invariants = {
  "opening an editor captures the current note": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (previous.value === "viewing" && event?.type === "edit") {
      expect(state.value).toBe("editing");
      expect(state.context.title).toBe(event.note.title);
      expect(state.context.body).toBe(event.note.body);
    }
  },
  "save captures the normalized draft": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (previous.value === "editing" && event?.type === "save" && state.value === "saving") {
      expect(state.context.submission).toEqual({
        rawTitle: previous.context.title,
        title: previous.context.title.trim(),
        body: previous.context.body,
      });
    }
  },
  "invalid saves explain the field problem": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (
      previous.value === "editing" &&
      event?.type === "save" &&
      (noteTitleError(previous.context.title) !== undefined ||
        noteBodyError(previous.context.body) !== undefined)
    ) {
      expect(state.value).toBe("editing");
      expect(state.context.showErrors).toBe(true);
      expect(state.context.title).toBe(previous.context.title);
      expect(state.context.body).toBe(previous.context.body);
    }
  },
  "valid captured saves": (state: State) => {
    if (state.value === "saving") {
      expect(noteTitleError(state.context.submission.title)).toBeUndefined();
      expect(noteBodyError(state.context.submission.body)).toBeUndefined();
      expect(state.context.submission.title).toBe(state.context.submission.rawTitle.trim());
    }
  },
  "newer typing survives a resolved save": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (previous.value === "saving" && event?.type === "saved") {
      const newer =
        previous.context.title !== previous.context.submission.rawTitle ||
        previous.context.body !== previous.context.submission.body;
      expect(state.value).toBe(newer ? "editing" : "viewing");
      expect(state.context.outcome).toEqual({ type: newer ? "savedBeforeNewerInput" : "saved" });
      expect(state.context.title).toBe(previous.context.title);
      expect(state.context.body).toBe(previous.context.body);
    }
  },
  "failed saves retain values and their reason": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (previous.value === "saving" && event?.type === "failed") {
      expect(state.value).toBe("editing");
      expect(state.context.title).toBe(previous.context.title);
      expect(state.context.body).toBe(previous.context.body);
      expect(state.context.outcome).toEqual({ type: "failed", failure: event.failure });
    }
  },
  "in-flight saves cannot be cancelled or replaced": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (
      previous.value === "saving" &&
      event !== undefined &&
      ["cancel", "save", "edit", "checkLatest"].includes(event.type)
    ) {
      expect(state).toEqual(previous);
    }
  },
  "refresh preserves edited values": (state: State, previous: State, event: Event | undefined) => {
    if (
      previous.value === "checkingLatest" &&
      (event?.type === "refreshed" || event?.type === "refreshFailed")
    ) {
      expect(state.context.title).toBe(previous.context.title);
      expect(state.context.body).toBe(previous.context.body);
    }
  },
};

it("explores every card transition with edit preservation invariants", () => {
  exploreWorkflow(noteCardWorkflow, { events, invariants });
});

it.each(Object.entries(invariants))(
  "preserves %s across generated drafts and events",
  (_name, invariant) => {
    fc.assert(
      fc.property(
        text,
        text,
        fc.array(generatedEvent, { maxLength: 100 }),
        (title, body, sequence) => {
          play(noteCardWorkflow, sequence, undefined, { invariant });
          play(
            noteCardWorkflow,
            [
              { type: "edit", note: { ...note, title, body } },
              { type: "save" },
              ...sequence,
              { type: "saved" },
            ],
            undefined,
            { invariant },
          );
        },
      ),
      { seed: 20261021, numRuns: 100 },
    );
  },
);

const note: NoteView = {
  id: "note-1",
  title: "Plan",
  body: "Draft the plan",
  lifecycle: "active",
  createdAt: "2026-05-27T00:00:00.000Z",
  updatedAt: "2026-05-27T00:00:00.000Z",
};
const events: ReadonlyArray<Event> = [
  { type: "edit", note },
  { type: "titleChanged", value: " Revised " },
  { type: "bodyChanged", value: "Body" },
  { type: "cancel" },
  { type: "save" },
  { type: "saved" },
  { type: "failed", failure: { kind: "unconfirmed", message: "Unconfirmed" } },
  { type: "failed", failure: { kind: "rejected", message: "Rejected" } },
  { type: "checkLatest" },
  { type: "refreshed" },
  { type: "refreshFailed" },
];
const text = fc.oneof(
  fc.string({ unit: "grapheme", maxLength: 220 }),
  fc.constantFrom(
    "",
    " \t\n",
    "🧑🏽‍🍳漢字",
    "x".repeat(200),
    "x".repeat(201),
    "x".repeat(10_000),
    "x".repeat(10_001),
  ),
);
const generatedEvent: fc.Arbitrary<Event> = fc.oneof(
  fc.constantFrom(...events),
  fc.record({ type: fc.constant("titleChanged" as const), value: text }),
  fc.record({ type: fc.constant("bodyChanged" as const), value: text }),
);

type State = typeof noteCardWorkflow.initialState;
type Event = Parameters<typeof noteCardWorkflow.transition>[1];
