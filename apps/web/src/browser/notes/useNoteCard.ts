import { useMutation } from "@tanstack/solid-query";

import { useUnsavedChanges } from "#browser/navigation/useUnsavedChanges.ts";
import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState, RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";
import { useWorkflow } from "#browser/workflow/useWorkflow.ts";
import type { NoteView } from "#contracts/notes/noteContract.ts";

import { noteCardWorkflow } from "./noteCardWorkflow";
import { describeNoteFailure } from "./noteFailure";
import { noteTitleError, noteBodyError } from "./noteInput";
import { noteMutations } from "./noteMutations";
import type { NoteRemote } from "./noteRemote";

export function useNoteCard(props: NoteCardOptions): {
  isEditing: () => boolean;
  isSaving: () => boolean;
  title: () => string;
  body: () => string;
  titleError: () => string | undefined;
  bodyError: () => string | undefined;
  feedback: () => ActionFeedbackState | undefined;
  edit: () => undefined;
  changeTitle: (value: string) => undefined;
  changeBody: (value: string) => undefined;
  cancel: () => undefined;
  save: () => Promise<void>;
} {
  const update = useMutation(() => noteMutations.update(props.remote));
  const signIn = useSignInRecovery();
  const card = useWorkflow(noteCardWorkflow, {
    onEnter: (state, send) => {
      switch (state.value) {
        case "saving":
          return update
            .mutate({
              id: props.note.id,
              title: state.context.submission.title,
              body: state.context.submission.body,
            })
            .then(
              () => send({ type: "saved" }),
              (error: unknown) => send({ type: "failed", failure: describeNoteFailure(error) }),
            );
        case "checkingLatest":
          return props.onRefresh().then(
            () => send({ type: "refreshed" }),
            () => send({ type: "refreshFailed" }),
          );
        case "editing":
          return props.onEditingChange(props.note);
        case "viewing":
          return props.onEditingChange(undefined);
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
                  readonly type: "saved" | "savedBeforeNewerInput" | "refreshed" | "refreshFailed";
                }
              | {
                  readonly type: "failed";
                  readonly failure: import("./noteFailure").NoteFailure;
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
                  readonly type: "saved" | "savedBeforeNewerInput" | "refreshed" | "refreshFailed";
                }
              | {
                  readonly type: "failed";
                  readonly failure: import("./noteFailure").NoteFailure;
                }
            )
          | undefined;
      } & {
        readonly submission: {
          readonly title: string;
          readonly body: string;
          readonly rawTitle: string;
        };
      }) => card.state().context;
  const isEditing = (): boolean => card.state().value !== "viewing";
  useUnsavedChanges(
    () =>
      isEditing() && (context().title !== props.note.title || context().body !== props.note.body),
  );

  const checkLatest: RecoveryAction = {
    label: "Check latest",
    pendingLabel: "Checking latest…",
    onAction: () => card.send({ type: "checkLatest" }),
  };

  return {
    isEditing,
    isSaving: () => update.isPending,
    title: () => context().title,
    body: () => context().body,
    titleError: () => (context().showErrors ? noteTitleError(context().title) : undefined),
    bodyError: () => (context().showErrors ? noteBodyError(context().body) : undefined),
    feedback: (): ActionFeedbackState | undefined => {
      const outcome = context().outcome;
      switch (outcome?.type) {
        case undefined:
          return undefined;
        case "saved":
          return { type: "success", message: "Changes saved." };
        case "savedBeforeNewerInput":
          return {
            type: "success",
            message: "Submitted changes saved. Your newer changes have not been saved.",
          };
        case "failed":
          return {
            type: "attention",
            message: outcome.failure.message,
            recovery:
              outcome.failure.kind === "authentication"
                ? signIn
                : outcome.failure.kind === "invalid_input" || outcome.failure.kind === "unavailable"
                  ? undefined
                  : checkLatest,
          };
        case "refreshed":
          return {
            type: "attention",
            message: "Latest state loaded. Review your changes before submitting.",
          };
        case "refreshFailed":
          return {
            type: "attention",
            message: "We could not refresh. Your changes are still here.",
            recovery: checkLatest,
          };
      }
    },
    edit: () => void card.send({ type: "edit", note: props.note }),
    changeTitle: (value: string) => void card.send({ type: "titleChanged", value }),
    changeBody: (value: string) => void card.send({ type: "bodyChanged", value }),
    cancel: () => void card.send({ type: "cancel" }),
    save: () => card.send({ type: "save" }),
  };
}

type NoteCardOptions = {
  readonly note: NoteView;
  readonly remote: NoteRemote;
  readonly onRefresh: () => Promise<void>;

  readonly onEditingChange: (note: NoteView | undefined) => void;
};
