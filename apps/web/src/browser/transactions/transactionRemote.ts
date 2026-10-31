import type { TransactionReviewView } from "#contracts/connections/transactionContract.ts";
import { readTransactionReviewServerFn } from "#server-functions/connections/transactionServerFunctions.ts";

import { requireTransactionSuccess } from "./transactionFailure";

export const transactionRemote: TransactionRemote = {
  read: (input, options) =>
    readTransactionReviewServerFn({ data: input, signal: options?.signal }).then(
      (result) => requireTransactionSuccess(result).review,
    ),
};

export type TransactionRemote = {
  readonly read: (
    input: { readonly set: string },
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TransactionReviewView>;
};
