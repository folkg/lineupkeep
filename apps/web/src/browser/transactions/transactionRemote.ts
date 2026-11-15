import type {
  TransactionConfirmRequest,
  TransactionDiscardMoveRequest,
  TransactionListRequest,
  TransactionMoveActionData,
  TransactionMoveConfirmationData,
  TransactionMoveListData,
  TransactionPlanData,
  TransactionPlanRequest,
  TransactionSaveMoveRequest,
  TransactionTimelineRequest,
} from "#contracts/connections/transactionContract.ts";
import {
  confirmTransactionMovesServerFn,
  discardTransactionMoveServerFn,
  listTransactionMovesServerFn,
  readTransactionPlanServerFn,
  readTransactionTimelineServerFn,
  saveTransactionMoveServerFn,
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
  confirm: (input, options) =>
    confirmTransactionMovesServerFn({ data: input, signal: options?.signal }).then((result) =>
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
  readonly confirm: (
    input: TransactionConfirmRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TransactionMoveConfirmationData>;
};
