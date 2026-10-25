import { AuthenticationRequestFailure } from "#browser/session/AuthenticationRequestFailure.ts";
import type {
  FeedbackErrorType,
  FeedbackRequestResult,
} from "#contracts/feedback/feedbackContract.ts";

export function requireFeedbackSuccess<TData>(result: FeedbackRequestResult<TData>): TData {
  switch (result.type) {
    case "success":
      return result.data;
    case "error":
      if (result.error.type === "auth.required") {
        throw new AuthenticationRequestFailure(result.error);
      }
      throw new FeedbackRequestFailure(result.error.type);
  }
}

export function describeFeedbackFailure(error: unknown): FeedbackFailure {
  if (error instanceof AuthenticationRequestFailure) {
    return {
      kind: "authentication",
      message: "Your session has ended. Sign in again to send this report.",
    };
  }
  if (error instanceof FeedbackRequestFailure) {
    switch (error.reason) {
      case "feedback.rate_limited":
        return {
          kind: "rejected",
          message:
            "You have sent several reports in the last hour. Try again a little later; your draft is still here.",
        };
      case "feedback.content_invalid":
      case "feedback.input_invalid":
        return {
          kind: "rejected",
          message: "Check the kind, title, and details, then send the report again.",
        };
      case "feedback.persistence_failed":
        break;
    }
  }
  return {
    kind: "unconfirmed",
    message: "We could not confirm the report was recorded. Check your reports before resending.",
  };
}

export type FeedbackFailure = {
  readonly kind: "authentication" | "rejected" | "unconfirmed";
  readonly message: string;
};

class FeedbackRequestFailure extends Error {
  constructor(readonly reason: FeedbackErrorType) {
    super(reason);
  }
}
