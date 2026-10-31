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
