import { setup, types } from "xstate/fsm";

import type { NoteView } from "#contracts/notes/noteContract.ts";

import type { NoteFailure } from "./noteFailure";
import { noteTitleError, noteBodyError } from "./noteInput";

const draftChanges = {
  titleChanged: ({ event }: DraftChange) => ({ context: { title: event.value } }),
  bodyChanged: ({ event }: DraftChange) => ({ context: { body: event.value } }),
};

export const noteCardWorkflow = setup({
  schemas: {
    context: types<CardDraft>(),
    events: {
      edit: types<{ readonly note: NoteView }>(),
      titleChanged: types<{ readonly value: string }>(),
      bodyChanged: types<{ readonly value: string }>(),
      cancel: types<object>(),
      save: types<object>(),
      saved: types<object>(),
      failed: types<{ readonly failure: NoteFailure }>(),
      checkLatest: types<object>(),
      refreshed: types<object>(),
      refreshFailed: types<object>(),
    },
  },
  states: {
    viewing: {},
    editing: {},
    saving: { schemas: { context: types<CardDraft & { readonly submission: NoteEdit }>() } },
    checkingLatest: {},
  },
}).createFSM({
  initial: "viewing",
  context: { title: "", body: "", showErrors: false, outcome: undefined },
  states: {
    viewing: {
      on: {
        edit: ({ event }) => ({
          target: "editing",
          context: {
            title: event.note.title,
            body: event.note.body,
            showErrors: false,
            outcome: undefined,
          },
        }),
      },
    },
    editing: {
      on: {
        ...draftChanges,
        cancel: { target: "viewing", context: { outcome: undefined } },
        save: ({ context }) =>
          noteTitleError(context.title) !== undefined || noteBodyError(context.body) !== undefined
            ? { context: { showErrors: true } }
            : {
                target: "saving",
                context: {
                  outcome: undefined,
                  submission: {
                    title: context.title.trim(),
                    body: context.body,
                    rawTitle: context.title,
                  },
                },
              },
        checkLatest: "checkingLatest",
      },
    },
    saving: {
      on: {
        ...draftChanges,
        saved: ({ context }) =>
          context.title !== context.submission.rawTitle || context.body !== context.submission.body
            ? { target: "editing", context: { outcome: { type: "savedBeforeNewerInput" } } }
            : { target: "viewing", context: { outcome: { type: "saved" } } },
        failed: ({ event }) => ({
          target: "editing",
          context: { outcome: { type: "failed", failure: event.failure } },
        }),
      },
    },
    checkingLatest: {
      on: {
        ...draftChanges,
        refreshed: { target: "editing", context: { outcome: { type: "refreshed" } } },
        refreshFailed: { target: "editing", context: { outcome: { type: "refreshFailed" } } },
      },
    },
  },
});

type DraftChange = { readonly event: { readonly value: string } };

type CardDraft = {
  readonly title: string;
  readonly body: string;
  readonly showErrors: boolean;
  readonly outcome: CardOutcome | undefined;
};

type NoteEdit = {
  readonly title: string;
  readonly body: string;

  readonly rawTitle: string;
};

type CardOutcome =
  | { readonly type: "saved" | "savedBeforeNewerInput" | "refreshed" | "refreshFailed" }
  | { readonly type: "failed"; readonly failure: NoteFailure };
