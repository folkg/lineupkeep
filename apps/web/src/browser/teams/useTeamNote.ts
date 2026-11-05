import { useMutation } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useUnsavedChanges } from "#browser/navigation/useUnsavedChanges.ts";
import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import { actionState } from "#browser/shared-ui/actionState.ts";
import type { ActionState } from "#browser/shared-ui/actionState.ts";
import type { TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { describeNoteFailure } from "./teamFailure";
import { teamMutations } from "./teamMutations";
import type { TeamRemote } from "./teamRemote";

export function useTeamNote(options: TeamNoteOptions): TeamNoteController {
  const signIn = useSignInRecovery();
  const [draft, setDraft] = createSignal(options.team().team.ownerNote ?? "");
  const [baseline, setBaseline] = createSignal(options.team().team.ownerNote ?? "");
  const [error, setError] = createSignal<string>();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [saved, setSaved] = createSignal(false);
  const limit = (): number => options.team().team.ownerNoteLimit;
  const count = (): number => Array.from(draft()).length;
  const dirty = (): boolean => draft() !== baseline();
  useUnsavedChanges(dirty);

  const save = useMutation(() => ({
    ...teamMutations.saveNote(options.remote()),
    onSuccess: (result) => {
      if (result.outcome === "rejected") {
        setSaved(false);
        setError(result.message);
        setFeedback({ type: "attention", message: "The note was not saved." });
        return;
      }
      setBaseline(result.note ?? "");
      setDraft(result.note ?? "");
      setError(undefined);
      setSaved(true);
    },
    onError: (cause: Error) => {
      setSaved(false);
      const failure = describeNoteFailure(cause);
      setFeedback({
        type: "attention",
        message: failure.message,
        ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
      });
    },
  }));

  const edit = (value: string): void => {
    setDraft(value);
    setSaved(false);
    setError(undefined);
    setFeedback(undefined);
  };

  const submit = (): void => {
    if (Array.from(draft().trim()).length > limit()) {
      setError(
        `A team note can be up to ${String(limit())} characters. Shorten it and save again.`,
      );
      setFeedback({ type: "attention", message: "The note was not saved." });
      return;
    }
    setSaved(false);
    setError(undefined);
    setFeedback(undefined);
    void save.mutate({ team: options.team().team.id, note: draft() });
  };

  return {
    draft,
    count,
    limit,
    error,
    feedback,
    saveState: (): ActionState => actionState(save.isPending, saved()),
    edit,
    submit,
  };
}

export type TeamNoteController = {
  readonly draft: Accessor<string>;
  readonly count: Accessor<number>;
  readonly limit: Accessor<number>;
  readonly error: Accessor<string | undefined>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly saveState: Accessor<ActionState>;
  readonly edit: (value: string) => void;
  readonly submit: () => void;
};

type TeamNoteOptions = {
  readonly team: Accessor<TeamSummaryView>;
  readonly remote: Accessor<TeamRemote>;
};
