import type {
  TransactionError,
  TransactionRequestResult,
} from "#contracts/connections/transactionContract.ts";

export function requireTransactionSuccess<TData>(result: TransactionRequestResult<TData>): TData {
  switch (result.type) {
    case "success":
      return result.data;
    case "error":
      if (result.error.type === "auth.required") {
        throw new TransactionAuthenticationFailure();
      }
      throw new TransactionFailure(result.error.type);
  }
}

export class TransactionAuthenticationFailure extends Error {
  constructor() {
    super("The session ended before the transaction request could be read.");
  }
}

class TransactionFailure extends Error {
  constructor(readonly reason: TransactionError["type"]) {
    super(reason);
  }
}

export type TransactionFailureDescription = {
  readonly kind: "authentication" | "conflict" | "failure";
  readonly message: string;
};

export function describeTransactionActionFailure(error: unknown): TransactionFailureDescription {
  if (error instanceof TransactionAuthenticationFailure) {
    return {
      kind: "authentication",
      message: "Your session ended before that change was saved. Sign in again to continue.",
    };
  }
  if (error instanceof TransactionFailure) {
    switch (error.reason) {
      case "transactions.run_in_progress":
        return {
          kind: "conflict",
          message:
            "Lineupgrade is already working on this team, so nothing changed. Try again in a moment.",
        };
      case "transactions.move_not_found":
        return {
          kind: "conflict",
          message: "That move is no longer open. Reload the page to see where it stands.",
        };
      case "transactions.team_not_found":
      case "transactions.input_invalid":
        return {
          kind: "failure",
          message: "That team or move is not available to this account.",
        };
      case "transactions.unavailable":
        return {
          kind: "failure",
          message: "Your league could not be read, so nothing was changed. Try again.",
        };
      case "transactions.persistence_failed":
        return {
          kind: "failure",
          message: "The change could not be recorded. Reload the page to see whether it applied.",
        };
    }
  }
  return {
    kind: "failure",
    message: "The change could not be saved. Reload the page before deciding what to do next.",
  };
}
