import type {
  DismissTransactionProposalData,
  DismissTransactionProposalRequest,
  SubmitTransactionReviewRequest,
  TransactionReviewData,
  TransactionReviewView,
  WithdrawTradeData,
  WithdrawTradeRequest,
} from "#contracts/connections/transactionContract.ts";
import {
  dismissTransactionProposalItemsServerFn,
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
    submitTransactionReviewServerFn({ data: input, signal: options?.signal }).then((result) =>
      requireTransactionSuccess(result),
    ),
  dismiss: (input, options) =>
    dismissTransactionProposalItemsServerFn({ data: input, signal: options?.signal }).then(
      (result) => requireTransactionSuccess(result),
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
    input: SubmitTransactionReviewRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TransactionReviewData>;
  readonly dismiss: (
    input: DismissTransactionProposalRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<DismissTransactionProposalData>;
  readonly withdraw: (
    input: WithdrawTradeRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<WithdrawTradeData>;
};
