import { setup, types } from "xstate/fsm";

import type { CreateNoteData, NoteLifecycleView } from "#contracts/notes/noteContract.ts";

import type { NoteFailure } from "./noteFailure";
import { noteTitleError, noteBodyError } from "./noteInput";

const draftChanges = {
  titleChanged: ({ event }: DraftChange) => ({ context: { title: event.value } }),
  bodyChanged: ({ event }: DraftChange) => ({ context: { body: event.value } }),
};

export const noteComposerWorkflow = setup({
  schemas: {
    context: types<ComposerDraft>(),
    events: {
      titleChanged: types<{ readonly value: string }>(),
      bodyChanged: types<{ readonly value: string }>(),
      submit: types<{ readonly requestId: string }>(),
      created: types<{ readonly lifecycle: NoteLifecycleView }>(),
      failed: types<{ readonly failure: NoteFailure }>(),
      retry: types<object>(),
      checkLatest: types<object>(),
      refreshed: types<object>(),
      refreshFailed: types<object>(),
    },
  },
  states: {
    editing: {},
    submitting: { schemas: { context: types<ComposerDraft & Submitted>() } },
    unconfirmed: { schemas: { context: types<ComposerDraft & Submitted>() } },
    checkingLatest: {},
  },
}).createFSM({
  initial: "editing",
  context: { title: "", body: "", showErrors: false, outcome: undefined },
  states: {
    editing: {
      on: {
        ...draftChanges,
        submit: ({ context, event }) =>
          noteTitleError(context.title) !== undefined || noteBodyError(context.body) !== undefined
            ? { context: { showErrors: true } }
            : {
                target: "submitting",
                context: {
                  showErrors: false,
                  outcome: undefined,
                  submission: {
                    rawTitle: context.title,
                    input: {
                      requestId: event.requestId,
                      title: context.title.trim(),
                      body: context.body,
                    },
                  },
                },
              },
        checkLatest: "checkingLatest",
      },
    },
    submitting: {
      on: {
        ...draftChanges,
        created: ({ context, event }) => {
          const hasNewerInput =
            context.title !== context.submission.rawTitle ||
            context.body !== context.submission.input.body;
          return {
            target: "editing",
            context: {
              title: hasNewerInput ? context.title : "",
              body: hasNewerInput ? context.body : "",
              outcome: { type: "added", lifecycle: event.lifecycle },
            },
          };
        },
        failed: ({ event }) =>
          event.failure.kind === "unconfirmed"
            ? { target: "unconfirmed" }
            : {
                target: "editing",
                context: { outcome: { type: "failed", failure: event.failure } },
              },
      },
    },
    unconfirmed: {
      on: {
        ...draftChanges,
        retry: "submitting",
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

type ComposerDraft = {
  readonly title: string;
  readonly body: string;
  readonly showErrors: boolean;
  readonly outcome: ComposerOutcome | undefined;
};

type Submitted = {
  readonly submission: {
    readonly input: CreateNoteData;

    readonly rawTitle: string;
  };
};

type ComposerOutcome =
  | { readonly type: "added"; readonly lifecycle: NoteLifecycleView }
  | { readonly type: "failed"; readonly failure: NoteFailure }
  | { readonly type: "refreshed" }
  | { readonly type: "refreshFailed" };
