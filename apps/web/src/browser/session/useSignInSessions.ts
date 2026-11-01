import { useMutation, useQuery } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import type { SignInSessionView } from "#contracts/auth/authContract.ts";

import { describeSignInSessionFailure } from "./signInSessionsFailure";
import { signInSessionsMutations, storeSignInSessions } from "./signInSessionsMutations";
import type { SignInSessionListQueryOptions } from "./signInSessionsQueries";
import type { SignInSessionsRemote } from "./signInSessionsRemote";

export function useSignInSessions(options: SignInSessionsOptions): SignInSessionsController {
  const listed = useQuery(() => options.query());
  const signIn = useSignInRecovery();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();

  const reportFailure = (error: unknown): void => {
    const failure = describeSignInSessionFailure(error);
    setFeedback({
      type: "attention",
      message: failure.message,
      ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
    });
  };

  const end = useMutation(() => ({
    ...signInSessionsMutations.end(options.remote()),
    onSuccess: (view, variables, onMutateResult, context) => {
      storeSignInSessions(view, variables, onMutateResult, context);
      setFeedback({ type: "success", message: sessionEndedMessage });
    },
    onError: reportFailure,
  }));

  const endOthers = useMutation(() => ({
    ...signInSessionsMutations.endOthers(options.remote()),
    onSuccess: (view, variables, onMutateResult, context) => {
      storeSignInSessions(view, variables, onMutateResult, context);
      setFeedback({ type: "success", message: otherSessionsEndedMessage });
    },
    onError: reportFailure,
  }));

  return {
    sessions: () => listed.data.sessions,
    isLoading: () => listed.isPending,
    loadFailure: () => listed.error,
    feedback,
    endingId: () => (end.isPending ? end.variables : undefined),
    endingOthers: () => endOthers.isPending,
    endSession: (session: SignInSessionView) => void end.mutate(session.id),
    endOtherSessions: () => void endOthers.mutate(),
    refresh: () => options.onRefresh(),
  };
}

export type SignInSessionsController = {
  readonly sessions: Accessor<ReadonlyArray<SignInSessionView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly endingId: Accessor<string | undefined>;
  readonly endingOthers: Accessor<boolean>;
  readonly endSession: (session: SignInSessionView) => void;
  readonly endOtherSessions: () => void;
  readonly refresh: () => Promise<void>;
};

type SignInSessionsOptions = {
  readonly query: () => SignInSessionListQueryOptions;
  readonly remote: () => SignInSessionsRemote;
  readonly onRefresh: () => Promise<void>;
};

const sessionEndedMessage = "That session ended. The device must sign in again.";
const otherSessionsEndedMessage = "Every other session ended. Those devices must sign in again.";
