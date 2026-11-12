import { mutationOptions } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";

import type {
  DismissTransactionProposalData,
  DismissTransactionProposalRequest,
  SubmitTransactionReviewRequest,
  TransactionReviewData,
  WithdrawTradeData,
  WithdrawTradeRequest,
} from "#contracts/connections/transactionContract.ts";

import { transactionQueries } from "./transactionQueries";
import type { TransactionRemote } from "./transactionRemote";

export const transactionMutations = {
  submit: (remote: Pick<TransactionRemote, "submit">) =>
    mutationOptions({
      mutationKey: ["transactions", "submit"],
      mutationFn: (input: SubmitTransactionReviewRequest) => remote.submit(input),
      onSuccess: storeSubmittedReview,
    }),
  dismiss: (remote: Pick<TransactionRemote, "dismiss">) =>
    mutationOptions({
      mutationKey: ["transactions", "dismiss"],
      mutationFn: (
        input: DismissTransactionProposalRequest,
      ): Promise<DismissTransactionProposalData> => remote.dismiss(input),
      onSuccess: (
        data: DismissTransactionProposalData,
        _variables: DismissTransactionProposalRequest,
        _onMutateResult: unknown,
        context: MutationFunctionContext,
      ) => {
        if (data.outcome === "dismissed") {
          void context.client.setQueryData(
            transactionQueries.reviewKey(data.review.set.id),
            data.review,
          );
        }
      },
    }),
  withdraw: (remote: Pick<TransactionRemote, "withdraw">) =>
    mutationOptions({
      mutationKey: ["transactions", "withdraw"],
      mutationFn: (input: WithdrawTradeRequest): Promise<WithdrawTradeData> =>
        remote.withdraw(input),
      onSuccess: (
        _data: WithdrawTradeData,
        _variables: WithdrawTradeRequest,
        _onMutateResult: unknown,
        context: MutationFunctionContext,
      ) => {
        void context.client.invalidateQueries({ queryKey: transactionQueries.all() });
      },
    }),
};

function storeSubmittedReview(
  data: TransactionReviewData,
  _variables: unknown,
  _onMutateResult: unknown,
  context: MutationFunctionContext,
): void {
  void context.client.setQueryData(transactionQueries.reviewKey(data.review.set.id), data.review);
}
