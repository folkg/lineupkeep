import { setup, types } from "xstate/fsm";

import type { NoteView } from "#contracts/notes/noteContract.ts";

import type { NoteFailure } from "./noteFailure";

const editorChanges = {
  editingChanged: ({ context, event }: EditingChange) => ({
    context: {
      retained: [
        ...context.retained.filter((note) => note.id !== event.id),
        ...(event.note === undefined ? [] : [event.note]),
      ],
    },
  }),
};

export const notesListWorkflow = setup({
  schemas: {
    context: types<NotesList>(),
    events: {
      change: types<NoteChange & { readonly kind: "trash" | "restore" | "delete" }>(),
      undo: types<object>(),
      confirmed: types<object>(),
      failed: types<{ readonly failure: NoteFailure }>(),
      checkLatest: types<object>(),
      refreshed: types<object>(),
      refreshFailed: types<object>(),
      editingChanged: types<{ readonly id: string; readonly note: NoteView | undefined }>(),
    },
  },
  states: {
    ready: {},
    changing: { schemas: { context: types<NotesList & { readonly change: NoteChange }>() } },
    checkingLatest: {},
  },
}).createFSM({
  initial: "ready",
  context: { retained: [], outcome: undefined },
  states: {
    ready: {
      on: {
        ...editorChanges,
        change: ({ event }) => ({
          target: "changing",
          context: { change: { kind: event.kind, note: event.note }, outcome: undefined },
        }),
        undo: ({ context }) =>
          context.outcome?.type === "confirmed" && context.outcome.change.kind === "trash"
            ? {
                target: "changing",
                context: { change: { kind: "undo", note: context.outcome.change.note } },
              }
            : undefined,
        checkLatest: "checkingLatest",
      },
    },
    changing: {
      on: {
        ...editorChanges,
        confirmed: ({ context }) => ({
          target: "ready",
          context: { outcome: { type: "confirmed", change: context.change } },
        }),
        failed: ({ context, event }) => ({
          target: "ready",
          context: { outcome: { type: "failed", change: context.change, failure: event.failure } },
        }),
      },
    },
    checkingLatest: {
      on: {
        ...editorChanges,
        refreshed: { target: "ready", context: { outcome: undefined } },
        refreshFailed: { target: "ready", context: { outcome: { type: "refreshFailed" } } },
      },
    },
  },
});

type EditingChange = {
  readonly context: NotesList;
  readonly event: { readonly id: string; readonly note: NoteView | undefined };
};

type NotesList = {
  readonly retained: ReadonlyArray<NoteView>;
  readonly outcome: NotesListOutcome | undefined;
};

export type NoteChange = {
  readonly kind: "trash" | "undo" | "restore" | "delete";
  readonly note: NoteView;
};

type NotesListOutcome =
  | { readonly type: "confirmed"; readonly change: NoteChange }
  | { readonly type: "failed"; readonly change: NoteChange; readonly failure: NoteFailure }
  | { readonly type: "refreshFailed" };
