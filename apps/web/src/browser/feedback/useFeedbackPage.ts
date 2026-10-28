import { useMutation, useQuery } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import type {
  FeedbackContextView,
  FeedbackReportView,
} from "#contracts/feedback/feedbackContract.ts";

import { checkFeedbackDraft, emptyFeedbackDraft } from "./feedbackDraft";
import type { FeedbackDraft, FeedbackDraftErrors } from "./feedbackDraft";
import { describeFeedbackFailure } from "./feedbackFailure";
import { feedbackMutations, storeFeedbackSubmission } from "./feedbackMutations";
import type { FeedbackListQueryOptions } from "./feedbackQueries";
import type { FeedbackRemote } from "./feedbackRemote";

export function useFeedbackPage(options: FeedbackPageOptions): FeedbackPageController {
  const reports = useQuery(() => options.reportsQuery());
  const signIn = useSignInRecovery();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [draft, setDraft] = createSignal<FeedbackDraft>(
    emptyFeedbackDraft(options.initialContext()),
  );
  const [errors, setErrors] = createSignal<FeedbackDraftErrors>({});

  const reportFailure = (error: unknown): void => {
    const failure = describeFeedbackFailure(error);
    setFeedback({
      type: "attention",
      message: failure.message,
      ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
    });
  };

  const submit = useMutation(() => ({
    ...feedbackMutations.submit(options.remote()),
    onSuccess: (data, variables, onMutateResult, context) => {
      storeFeedbackSubmission(data, variables, onMutateResult, context);
      setDraft(emptyFeedbackDraft(options.initialContext()));
      setErrors({});
      setFeedback({ type: "success", message: "Thanks, your report is recorded." });
    },
    onError: reportFailure,
  }));

  const edit = (patch: Partial<FeedbackDraft>): void => {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      if (patch.kind !== undefined) {
        delete next.kind;
      }
      if (patch.title !== undefined) {
        delete next.title;
      }
      if (patch.body !== undefined) {
        delete next.body;
      }
      return next;
    });
  };

  const send = (): void => {
    const checked = checkFeedbackDraft(draft());
    if (!checked.valid) {
      setErrors(checked.errors);
      setFeedback({ type: "attention", message: "Check the highlighted fields." });
      return;
    }
    setErrors({});
    setFeedback({ type: "pending", message: "Sending your report…" });
    void submit.mutate(checked.submission);
  };

  return {
    reports: () => reports.data.reports,
    isLoading: () => reports.isPending,
    loadFailure: () => reports.error,
    feedback,
    submitting: () => submit.isPending,
    draft,
    errors,
    setKind: (kind) => edit({ kind }),
    setTitle: (title) => edit({ title }),
    setBody: (body) => edit({ body }),
    send,
    refresh: () => options.onRefresh(),
  };
}

export type FeedbackPageController = {
  readonly reports: Accessor<ReadonlyArray<FeedbackReportView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly submitting: Accessor<boolean>;
  readonly draft: Accessor<FeedbackDraft>;
  readonly errors: Accessor<FeedbackDraftErrors>;
  readonly setKind: (kind: FeedbackDraft["kind"]) => void;
  readonly setTitle: (title: string) => void;
  readonly setBody: (body: string) => void;
  readonly send: () => void;
  readonly refresh: () => Promise<void>;
};

type FeedbackPageOptions = {
  readonly reportsQuery: Accessor<FeedbackListQueryOptions>;
  readonly remote: Accessor<FeedbackRemote>;
  readonly initialContext: Accessor<FeedbackContextView>;
  readonly onRefresh: () => Promise<void>;
};
