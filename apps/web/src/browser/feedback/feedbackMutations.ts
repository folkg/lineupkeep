import { mutationOptions } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";

import type { FeedbackSubmissionData } from "#contracts/feedback/feedbackContract.ts";

import { feedbackQueries } from "./feedbackQueries";
import type { FeedbackRemote } from "./feedbackRemote";

export const feedbackMutations = {
  submit: (remote: FeedbackRemote) =>
    mutationOptions({
      mutationKey: ["feedback", "submit"],
      mutationFn: remote.submit,
      onSuccess: storeFeedbackSubmission,
    }),
};

export function storeFeedbackSubmission(
  view: FeedbackSubmissionData,
  _variables: unknown,
  _onMutateResult: unknown,
  context: MutationFunctionContext,
): void {
  void context.client.setQueryData(feedbackQueries.listKey, { reports: view.reports });
}
