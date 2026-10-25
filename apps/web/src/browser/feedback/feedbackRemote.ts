import type {
  FeedbackDraftData,
  FeedbackListData,
  FeedbackSubmissionData,
} from "#contracts/feedback/feedbackContract.ts";
import {
  listFeedbackServerFn,
  submitFeedbackServerFn,
} from "#server-functions/feedback/feedbackServerFunctions.ts";

import { requireFeedbackSuccess } from "./feedbackFailure";

export const feedbackRemote: FeedbackRemote = {
  list: (options) => listFeedbackServerFn({ signal: options.signal }).then(requireFeedbackSuccess),
  submit: (input) => submitFeedbackServerFn({ data: input }).then(requireFeedbackSuccess),
};

export type FeedbackRemote = {
  readonly list: (options: FeedbackListRequestOptions) => Promise<FeedbackListData>;
  readonly submit: (input: FeedbackDraftData) => Promise<FeedbackSubmissionData>;
};

type FeedbackListRequestOptions = {
  readonly signal: AbortSignal;
};
