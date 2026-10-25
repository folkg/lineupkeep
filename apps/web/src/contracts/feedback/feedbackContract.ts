import type {
  FeedbackKind,
  FeedbackStatus,
  FeedbackSubmission,
  FeedbackSurface,
} from "@lineupkeep/backend/feedback/Feedback";

import type { AuthenticationFailure } from "#contracts/auth/authContract.ts";
import type { UseCaseResult } from "#contracts/useCaseContract.ts";

export type FeedbackContextView = {
  readonly tool?: string;
  readonly team?: string;
  readonly client?: string;
  readonly surface?: FeedbackSurface;
};

export type FeedbackReportView = {
  readonly id: string;
  readonly submitter: "user" | "agent";
  readonly kind: FeedbackKind;
  readonly status: FeedbackStatus;
  readonly title: string;
  readonly body: string;
  readonly context: FeedbackContextView;
  readonly resolutionNote?: string;
  readonly closedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type FeedbackListData = {
  readonly reports: ReadonlyArray<FeedbackReportView>;
};

export type FeedbackSubmissionData = {
  readonly report: FeedbackReportView;
  readonly reports: ReadonlyArray<FeedbackReportView>;
};

export type FeedbackDraftData = typeof FeedbackSubmission.Encoded;

export type FeedbackErrorType =
  | "feedback.input_invalid"
  | "feedback.content_invalid"
  | "feedback.rate_limited"
  | "feedback.persistence_failed";

export type FeedbackRequestResult<A> =
  | UseCaseResult<A, FeedbackErrorType>
  | { readonly type: "error"; readonly error: AuthenticationFailure };
