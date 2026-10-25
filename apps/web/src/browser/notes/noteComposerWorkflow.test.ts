import * as fc from "fast-check";
import { expect, it } from "vitest";

import { exploreWorkflow, play } from "#browser/workflow/workflowTest.ts";

import { noteComposerWorkflow } from "./noteComposerWorkflow";
import { noteTitleError, noteBodyError } from "./noteInput";

const invariants = {
  "invalid submissions explain the field problem": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (
      previous.value === "editing" &&
      event?.type === "submit" &&
      (noteTitleError(previous.context.title) !== undefined ||
        noteBodyError(previous.context.body) !== undefined)
    ) {
      expect(state.value).toBe("editing");
      expect(state.context.showErrors).toBe(true);
      expect(state.context.title).toBe(previous.context.title);
      expect(state.context.body).toBe(previous.context.body);
    }
  },
  "refresh preserves the draft": (state: State, previous: State, event: Event | undefined) => {
    if (
      previous.value === "checkingLatest" &&
      (event?.type === "refreshed" || event?.type === "refreshFailed")
    ) {
      expect(state.context.title).toBe(previous.context.title);
      expect(state.context.body).toBe(previous.context.body);
      expect(state.value).toBe("editing");
      expect(state.context.outcome).toEqual({ type: event.type });
    }
  },
  "submission captures the normalized draft and request": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (previous.value === "editing" && event?.type === "submit" && state.value === "submitting") {
      expect(state.context.submission).toEqual({
        rawTitle: previous.context.title,
        input: {
          requestId: event.requestId,
          title: previous.context.title.trim(),
          body: previous.context.body,
        },
      });
    }
  },
  "valid captured submissions": (state: State) => {
    if (state.value === "submitting" || state.value === "unconfirmed") {
      expect(state.context.submission.input.requestId.length).toBeGreaterThan(0);
      expect(noteTitleError(state.context.submission.input.title)).toBeUndefined();
      expect(noteBodyError(state.context.submission.input.body)).toBeUndefined();
    }
  },
  "safe replay identity": (state: State, previous: State, event: Event | undefined) => {
    if (
      previous.value === "unconfirmed" ||
      (previous.value === "submitting" &&
        event?.type === "failed" &&
        event.failure.kind === "unconfirmed")
    ) {
      expect(state.value === "submitting" || state.value === "unconfirmed").toBe(true);
      if (state.value === "submitting" || state.value === "unconfirmed") {
        expect(state.context.submission).toEqual(previous.context.submission);
      }
    }
    if (event?.type === "retry" && previous.value !== "unconfirmed") {
      expect(state).toEqual(previous);
    }
  },
  "newer typing survives confirmation": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (previous.value === "submitting" && event?.type === "created") {
      const newer =
        previous.context.title !== previous.context.submission.rawTitle ||
        previous.context.body !== previous.context.submission.input.body;
      expect(state.context.title).toBe(newer ? previous.context.title : "");
      expect(state.context.body).toBe(newer ? previous.context.body : "");
      expect(state.value).toBe("editing");
      expect(state.context.outcome).toEqual({ type: "added", lifecycle: event.lifecycle });
    }
  },
  "rejection retains the draft without offering replay": (
    state: State,
    previous: State,
    event: Event | undefined,
  ) => {
    if (
      previous.value === "submitting" &&
      event?.type === "failed" &&
      event.failure.kind !== "unconfirmed"
    ) {
      expect(state.value).toBe("editing");
      expect(state.context.title).toBe(previous.context.title);
      expect(state.context.body).toBe(previous.context.body);
      expect(state.context.outcome).toEqual({ type: "failed", failure: event.failure });
    }
  },
};

it("explores every composer transition with recovery invariants", () => {
  exploreWorkflow(noteComposerWorkflow, { events, invariants });
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
          play(noteComposerWorkflow, sequence, undefined, { invariant });
          play(
            noteComposerWorkflow,
            [
              { type: "titleChanged", value: title },
              { type: "bodyChanged", value: body },
              { type: "submit", requestId: "generated-request" },
              ...sequence,
              { type: "created", lifecycle: "active" },
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

const events: ReadonlyArray<Event> = [
  { type: "titleChanged", value: " Plan " },
  { type: "bodyChanged", value: "Body" },
  { type: "submit", requestId: "request" },
  { type: "created", lifecycle: "active" },
  { type: "failed", failure: { kind: "unconfirmed", message: "Unconfirmed" } },
  { type: "failed", failure: { kind: "rejected", message: "Rejected" } },
  { type: "failed", failure: { kind: "conflict", message: "Conflict" } },
  { type: "retry" },
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
  fc.record({ type: fc.constant("submit" as const), requestId: fc.uuid() }),
);

type State = typeof noteComposerWorkflow.initialState;
type Event = Parameters<typeof noteComposerWorkflow.transition>[1];
