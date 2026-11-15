import type {
  TransactionDiscardMoveRequest,
  TransactionListRequest,
  TransactionMoveActionData,
  TransactionMoveListData,
  TransactionPlanData,
  TransactionPlanRequest,
  TransactionSaveMoveRequest,
  TransactionSubmitTodayData,
  TransactionSubmitTodayRequest,
  TransactionTimelineRequest,
} from "#contracts/connections/transactionContract.ts";
import {
  discardTransactionMoveServerFn,
  listTransactionMovesServerFn,
  readTransactionPlanServerFn,
  readTransactionTimelineServerFn,
  saveTransactionMoveServerFn,
  submitTransactionTodayServerFn,
} from "#server-functions/connections/transactionServerFunctions.ts";

import { requireTransactionSuccess } from "./transactionFailure";

export const transactionRemote: TransactionRemote = {
  timeline: (input, options) =>
    readTransactionTimelineServerFn({ data: input, signal: options?.signal }).then((result) =>
      requireTransactionSuccess(result),
    ),
  list: (input, options) =>
    listTransactionMovesServerFn({ data: input, signal: options?.signal }).then((result) =>
      requireTransactionSuccess(result),
    ),
  plan: (input, options) =>
    readTransactionPlanServerFn({ data: input, signal: options?.signal }).then((result) =>
      requireTransactionSuccess(result),
    ),
  save: (input, options) =>
    saveTransactionMoveServerFn({ data: input, signal: options?.signal }).then((result) =>
      requireTransactionSuccess(result),
    ),
  discard: (input, options) =>
    discardTransactionMoveServerFn({ data: input, signal: options?.signal }).then((result) =>
      requireTransactionSuccess(result),
    ),
  submitToday: (input, options) =>
    submitTransactionTodayServerFn({ data: input, signal: options?.signal }).then((result) =>
      requireTransactionSuccess(result),
    ),
};

export type TransactionRemote = {
  readonly timeline: (
    input: TransactionTimelineRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TransactionMoveListData>;
  readonly list: (
    input: TransactionListRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TransactionMoveListData>;
  readonly plan: (
    input: TransactionPlanRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TransactionPlanData>;
  readonly save: (
    input: TransactionSaveMoveRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TransactionMoveActionData>;
  readonly discard: (
    input: TransactionDiscardMoveRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TransactionMoveActionData>;
  readonly submitToday: (
    input: TransactionSubmitTodayRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TransactionSubmitTodayData>;
};
