import type {
  FeedbackContentInvalid,
  FeedbackPersistenceFailed,
  FeedbackRateLimited,
  FeedbackReport,
} from "@lineupkeep/backend/feedback/Feedback";
import { DateTime, Schema } from "effect";

import type {
  FeedbackErrorType,
  FeedbackReportView,
} from "#contracts/feedback/feedbackContract.ts";
import type { ExpectedFailure } from "#server/backendEntry.ts";

export function toFeedbackReportView(report: FeedbackReport): FeedbackReportView {
  return {
    id: report.id,
    submitter: report.submitter.kind,
    kind: report.kind,
    status: report.status,
    title: report.title,
    body: report.body,
    context: report.context,
    ...(report.resolutionNote === undefined ? {} : { resolutionNote: report.resolutionNote }),
    ...(report.closedAt === undefined ? {} : { closedAt: DateTime.formatIso(report.closedAt) }),
    createdAt: DateTime.formatIso(report.createdAt),
    updatedAt: DateTime.formatIso(report.updatedAt),
  };
}

export function mapFeedbackError(
  error: FeedbackContentInvalid | FeedbackRateLimited | FeedbackPersistenceFailed,
): ExpectedFailure<FeedbackErrorType> {
  switch (error._tag) {
    case "feedback.content_invalid":
      return { type: "feedback.content_invalid", outcome: "rejected" };
    case "feedback.rate_limited":
      return { type: "feedback.rate_limited", outcome: "rejected" };
    case "feedback.persistence_failed":
      return { type: "feedback.persistence_failed", outcome: "failure" };
  }
}

export class FeedbackInputInvalid extends Schema.TaggedError<
  FeedbackInputInvalid,
  { readonly brand: unique symbol }
>()("FeedbackInputInvalid", {}) {}
