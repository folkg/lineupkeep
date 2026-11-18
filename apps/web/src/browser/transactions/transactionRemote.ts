import type {
  TransactionConfirmRequest,
  TransactionDiscardGroupRequest,
  TransactionDiscardMoveRequest,
  TransactionFixMoveRequest,
  TransactionListRequest,
  TransactionMoveActionData,
  TransactionMoveConfirmationData,
  TransactionMoveListData,
  TransactionMoveRetryData,
  TransactionPlanData,
  TransactionPlanRequest,
  TransactionRetryMoveRequest,
  TransactionSaveMoveRequest,
  TransactionTimelineRequest,
} from "#contracts/connections/transactionContract.ts";
import {
  confirmTransactionMovesServerFn,
  discardTransactionGroupServerFn,
  discardTransactionMoveServerFn,
  fixTransactionMoveServerFn,
  listTransactionMovesServerFn,
  readTransactionPlanServerFn,
  readTransactionTimelineServerFn,
  retryTransactionMoveServerFn,
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
  discardGroup: (input, options) =>
    discardTransactionGroupServerFn({ data: input, signal: options?.signal }).then((result) =>
      requireTransactionSuccess(result),
    ),
  fix: (input, options) =>
    fixTransactionMoveServerFn({ data: input, signal: options?.signal }).then((result) =>
      requireTransactionSuccess(result),
    ),
  retry: (input, options) =>
    retryTransactionMoveServerFn({ data: input, signal: options?.signal }).then((result) =>
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
  readonly discardGroup: (
    input: TransactionDiscardGroupRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TransactionMoveActionData>;
  readonly fix: (
    input: TransactionFixMoveRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TransactionMoveActionData>;
  readonly retry: (
    input: TransactionRetryMoveRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TransactionMoveRetryData>;
  readonly confirm: (
    input: TransactionConfirmRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TransactionMoveConfirmationData>;
};
