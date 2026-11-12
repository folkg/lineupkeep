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

export function describeTradeWithdrawalFailure(error: unknown): TransactionFailureDescription {
  if (error instanceof TransactionReviewAuthenticationFailure) {
    return {
      kind: "authentication",
      message: "Your session ended before the withdrawal could be sent. Sign in again to continue.",
    };
  }
  if (error instanceof TransactionReviewFailure) {
    switch (error.reason) {
      case "transactions.trade_not_pending":
        return {
          kind: "conflict",
          message:
            "Your league no longer lists this offer as pending, so nothing was withdrawn. Reload to check.",
        };
      case "transactions.trade_not_found":
        return {
          kind: "failure",
          message: "That trade offer is not available for this team. Reload the review.",
        };
      case "transactions.unavailable":
        return {
          kind: "failure",
          message:
            "The withdrawal could not be confirmed, so it may or may not have applied. Check the trade page before trying again.",
        };
      case "transactions.set_not_found":
      case "transactions.input_invalid":
        return {
          kind: "failure",
          message: "This trade is not available to the current account, so nothing was withdrawn.",
        };
      case "transactions.submission_in_progress":
      case "transactions.set_closed":
      case "transactions.items_not_open":
      case "transactions.nothing_included":
      case "transactions.persistence_failed":
        return {
          kind: "failure",
          message:
            "The withdrawal could not be completed. Reload the review to see whether the offer is still pending.",
        };
    }
  }
  return {
    kind: "failure",
    message: "The withdrawal could not be sent. Reload the review before deciding what to do next.",
  };
}

export function describeTransactionDismissalFailure(error: unknown): TransactionFailureDescription {
  if (error instanceof TransactionReviewAuthenticationFailure) {
    return {
      kind: "authentication",
      message: "Your session ended before this move could be dismissed. Sign in again to continue.",
    };
  }
  if (error instanceof TransactionReviewFailure) {
    switch (error.reason) {
      case "transactions.submission_in_progress":
      case "transactions.set_closed":
        return {
          kind: "conflict",
          message:
            "This plan is changing, so the move was not dismissed. Reload the plan to see where it stands.",
        };
      case "transactions.items_not_open":
        return {
          kind: "conflict",
          message:
            "That move is no longer open, so nothing was dismissed. Reload the plan to see its state.",
        };
      case "transactions.set_not_found":
      case "transactions.input_invalid":
        return {
          kind: "failure",
          message: "This plan is not available to the current account, so nothing was dismissed.",
        };
      case "transactions.unavailable":
        return {
          kind: "failure",
          message:
            "The dismissal could not be checked against current state, so nothing was dismissed. Refresh the plan and try a current move.",
        };
      case "transactions.persistence_failed":
        return {
          kind: "failure",
          message:
            "The dismissal could not be recorded. Refresh the plan to see whether it applied.",
        };
      case "transactions.nothing_included":
      case "transactions.trade_not_found":
      case "transactions.trade_not_pending":
        return {
          kind: "failure",
          message:
            "The dismissal could not be completed. Refresh the plan before deciding what to do next.",
        };
    }
  }
  return {
    kind: "failure",
    message: "The move could not be dismissed. Refresh the plan before deciding what to do next.",
  };
}

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
      case "transactions.set_closed":
        return {
          kind: "conflict",
          message:
            "This plan is closed: every move has settled or been dismissed, so nothing was sent. Ask the agent to propose a new plan for another move.",
        };
      case "transactions.submission_in_progress":
        return {
          kind: "conflict",
          message:
            "This proposal is already being submitted, so nothing else was sent. Reload the review in a moment to see the outcome.",
        };
      case "transactions.items_not_open":
        return {
          kind: "failure",
          message:
            "That move is no longer open, so nothing else was sent. Reload the review to see its state.",
        };
      case "transactions.nothing_included":
        return {
          kind: "failure",
          message:
            "No move that has not run was included. Select a move that has not been sent, or add a replacement to this set.",
        };
      case "transactions.trade_not_found":
        return {
          kind: "failure",
          message: "That trade offer is not available for this team. Reload the review.",
        };
      case "transactions.trade_not_pending":
        return {
          kind: "conflict",
          message:
            "Your league no longer lists this offer as pending, so nothing was withdrawn. Reload to check.",
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
