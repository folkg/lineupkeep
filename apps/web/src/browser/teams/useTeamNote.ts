import { useMutation } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useUnsavedChanges } from "#browser/navigation/useUnsavedChanges.ts";
import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
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
  const limit = (): number => options.team().team.ownerNoteLimit;
  const count = (): number => Array.from(draft()).length;
  const dirty = (): boolean => draft() !== baseline();
  useUnsavedChanges(dirty);

  const save = useMutation(() => ({
    ...teamMutations.saveNote(options.remote()),
    onSuccess: (result) => {
      if (result.outcome === "rejected") {
        setError(result.message);
        setFeedback({ type: "attention", message: "The note was not saved." });
        return;
      }
      setBaseline(result.note ?? "");
      setDraft(result.note ?? "");
      setError(undefined);
      setFeedback({ type: "success", message: "Note saved." });
    },
    onError: (cause: Error) => {
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
    setError(undefined);
    setFeedback({ type: "pending", message: "Saving your note…" });
    void save.mutate({ team: options.team().team.id, note: draft() });
  };

  return {
    draft,
    count,
    limit,
    error,
    feedback,
    saving: () => save.isPending,
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
  readonly saving: Accessor<boolean>;
  readonly edit: (value: string) => void;
  readonly submit: () => void;
};

type TeamNoteOptions = {
  readonly team: Accessor<TeamSummaryView>;
  readonly remote: Accessor<TeamRemote>;
};
