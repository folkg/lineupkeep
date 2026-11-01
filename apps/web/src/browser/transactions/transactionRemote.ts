import type {
  TransactionReviewView,
  WithdrawTradeData,
  WithdrawTradeRequest,
} from "#contracts/connections/transactionContract.ts";
import {
  readTransactionReviewServerFn,
  submitTransactionReviewServerFn,
  withdrawTradeServerFn,
} from "#server-functions/connections/transactionServerFunctions.ts";

import { requireTransactionSuccess } from "./transactionFailure";

export const transactionRemote: TransactionRemote = {
  read: (input, options) =>
    readTransactionReviewServerFn({ data: input, signal: options?.signal }).then(
      (result) => requireTransactionSuccess(result).review,
    ),
  submit: (input, options) =>
    submitTransactionReviewServerFn({ data: input, signal: options?.signal }).then(
      (result) => requireTransactionSuccess(result).review,
    ),
  withdraw: (input, options) =>
    withdrawTradeServerFn({ data: input, signal: options?.signal }).then((result) =>
      requireTransactionSuccess(result),
    ),
};

export type TransactionRemote = {
  readonly read: (
    input: { readonly set: string },
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TransactionReviewView>;
  readonly submit: (
    input: { readonly set: string; readonly include: ReadonlyArray<string> },
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TransactionReviewView>;
  readonly withdraw: (
    input: WithdrawTradeRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<WithdrawTradeData>;
};
