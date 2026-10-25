import { useMutation } from "@tanstack/solid-query";

import { useUnsavedChanges } from "#browser/navigation/useUnsavedChanges.ts";
import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState, RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";
import { useWorkflow } from "#browser/workflow/useWorkflow.ts";

import { noteComposerWorkflow } from "./noteComposerWorkflow";
import { describeNoteFailure } from "./noteFailure";
import { noteTitleError, noteBodyError } from "./noteInput";
import { noteMutations } from "./noteMutations";
import type { NoteRemote } from "./noteRemote";

export function useNoteComposer(props: NoteComposerOptions): {
  title: () => string;
  body: () => string;
  titleError: () => string | undefined;
  bodyError: () => string | undefined;
  isSubmitting: () => boolean;
  isUnconfirmed: () => boolean;
  feedback: () => ActionFeedbackState | undefined;
  changeTitle: (value: string) => undefined;
  changeBody: (value: string) => undefined;
  submit: () => undefined;
} {
  const create = useMutation(() => noteMutations.create(props.remote));
  const signIn = useSignInRecovery();
  const composer = useWorkflow(noteComposerWorkflow, {
    onEnter: (state, send) => {
      switch (state.value) {
        case "submitting":
          return create.mutate(state.context.submission.input).then(
            (note) => send({ type: "created", lifecycle: note.lifecycle }),
            (error: unknown) => send({ type: "failed", failure: describeNoteFailure(error) }),
          );
        case "checkingLatest":
          return props.onRefresh().then(
            () => send({ type: "refreshed" }),
            () => send({ type: "refreshFailed" }),
          );
        case "editing":
        case "unconfirmed":
          return undefined;
      }
    },
  });
  const context = ():
    | {
        readonly title: string;
        readonly body: string;
        readonly showErrors: boolean;
        readonly outcome:
          | (
              | {
                  readonly type: "added";
                  readonly lifecycle: import("#contracts/notes/noteContract.ts").NoteLifecycleView;
                }
              | {
                  readonly type: "failed";
                  readonly failure: import("./noteFailure").NoteFailure;
                }
              | {
                  readonly type: "refreshed";
                }
              | {
                  readonly type: "refreshFailed";
                }
            )
          | undefined;
      }
    | ({
        readonly title: string;
        readonly body: string;
        readonly showErrors: boolean;
        readonly outcome:
          | (
              | {
                  readonly type: "added";
                  readonly lifecycle: import("#contracts/notes/noteContract.ts").NoteLifecycleView;
                }
              | {
                  readonly type: "failed";
                  readonly failure: import("./noteFailure").NoteFailure;
                }
              | {
                  readonly type: "refreshed";
                }
              | {
                  readonly type: "refreshFailed";
                }
            )
          | undefined;
      } & {
        readonly submission: {
          readonly input: import("#contracts/notes/noteContract.ts").CreateNoteData;
          readonly rawTitle: string;
        };
      }) => composer.state().context;
  useUnsavedChanges(() => context().title.length > 0 || context().body.length > 0);

  const checkLatest: RecoveryAction = {
    label: "Check latest",
    pendingLabel: "Checking latest…",
    onAction: () => composer.send({ type: "checkLatest" }),
  };

  const outcomeFeedback = (): ActionFeedbackState | undefined => {
    const outcome = context().outcome;
    switch (outcome?.type) {
      case undefined:
        return undefined;
      case "added":
        return {
          type: "success",
          message: outcome.lifecycle === "trashed" ? "Submitted note is in Trash." : "Note added.",
        };
      case "failed":
        return {
          type: "attention",
          message: outcome.failure.message,
          recovery:
            outcome.failure.kind === "authentication"
              ? signIn
              : outcome.failure.kind === "invalid_input"
                ? undefined
                : checkLatest,
        };
      case "refreshed":
        return {
          type: "attention",
          message: "Latest notes loaded. Review them before adding another note.",
        };
      case "refreshFailed":
        return {
          type: "attention",
          message: "We could not refresh your notes.",
          recovery: checkLatest,
        };
    }
  };

  return {
    title: () => context().title,
    body: () => context().body,
    titleError: () => (context().showErrors ? noteTitleError(context().title) : undefined),
    bodyError: () => (context().showErrors ? noteBodyError(context().body) : undefined),
    isSubmitting: () => create.isPending,
    isUnconfirmed: () => composer.state().value === "unconfirmed",
    feedback: (): ActionFeedbackState | undefined => {
      if (create.isPending) {
        return { type: "pending", message: "Adding note…" };
      }
      switch (composer.state().value) {
        case "unconfirmed":
          return {
            type: "attention",
            message:
              "We could not confirm adding your note. Retrying sends the same request, so it cannot create a duplicate.",
            recovery: {
              label: "Retry submitted note",
              pendingLabel: "Retrying submitted note…",
              onAction: () => composer.send({ type: "retry" }),
            },
          };
        case "editing":
        case "submitting":
        case "checkingLatest":
          return outcomeFeedback();
      }
    },
    changeTitle: (value: string) => void composer.send({ type: "titleChanged", value }),
    changeBody: (value: string) => void composer.send({ type: "bodyChanged", value }),
    submit: () => void composer.send({ type: "submit", requestId: crypto.randomUUID() }),
  };
}

type NoteComposerOptions = {
  readonly remote: NoteRemote;
  readonly onRefresh: () => Promise<void>;
};
