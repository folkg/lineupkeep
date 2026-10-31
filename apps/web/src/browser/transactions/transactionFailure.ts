import type {
  TransactionReviewError,
  TransactionReviewRequestResult,
} from "#contracts/connections/transactionContract.ts";

export function requireTransactionSuccess<TData>(
  result: TransactionReviewRequestResult<TData>,
): TData {
  switch (result.type) {
    case "success":
      return result.data;
    case "error":
      if (result.error.type === "auth.required") {
        throw new TransactionReviewAuthenticationFailure();
      }
      throw new TransactionReviewFailure(result.error.type);
  }
}

export class TransactionReviewAuthenticationFailure extends Error {
  constructor() {
    super("The session ended before the proposal could be read.");
  }
}

export class TransactionReviewFailure extends Error {
  constructor(readonly reason: TransactionReviewError["type"]) {
    super(reason);
  }
}

export type TransactionFailureDescription = {
  readonly kind: "authentication" | "conflict" | "failure";
  readonly message: string;
};

export function describeTransactionSubmissionFailure(
  error: unknown,
): TransactionFailureDescription {
  if (error instanceof TransactionReviewAuthenticationFailure) {
    return {
      kind: "authentication",
      message:
        "Your session ended before this submission could be sent. Sign in again to continue.",
    };
  }
  if (error instanceof TransactionReviewFailure) {
    switch (error.reason) {
      case "transactions.already_submitted":
        return {
          kind: "conflict",
          message:
            "This proposal was already submitted, so nothing else was sent. Reload the review to see what happened.",
        };
      case "transactions.set_expired":
        return {
          kind: "conflict",
          message:
            "This proposal expired before it could be submitted. Nothing was sent; propose the moves again.",
        };
      case "transactions.nothing_included":
        return {
          kind: "failure",
          message: "No move was included. Select at least one current move and submit again.",
        };
      case "transactions.set_not_found":
      case "transactions.input_invalid":
        return {
          kind: "failure",
          message: "This proposal is not available to the current account, so nothing was sent.",
        };
      case "transactions.unavailable":
        return {
          kind: "failure",
          message:
            "This proposal could not be checked against current state, so nothing was sent. Refresh the review and try a current set.",
        };
      case "transactions.persistence_failed":
        return {
          kind: "failure",
          message:
            "The submission could not be recorded. Refresh the review to see whether it was claimed; a submitted set is never sent again.",
        };
    }
  }
  return {
    kind: "failure",
    message:
      "The submission could not be sent. Refresh the review before deciding what to do next.",
  };
}
