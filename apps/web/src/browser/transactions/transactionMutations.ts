import { mutationOptions } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";

import type { TransactionReviewView } from "#contracts/connections/transactionContract.ts";

import { transactionQueries } from "./transactionQueries";
import type { TransactionRemote } from "./transactionRemote";

export const transactionMutations = {
  submit: (remote: Pick<TransactionRemote, "submit">) =>
    mutationOptions({
      mutationKey: ["transactions", "submit"],
      mutationFn: (input: { readonly set: string; readonly include: ReadonlyArray<string> }) =>
        remote.submit(input),
      onSuccess: storeSubmittedReview,
    }),
};

function storeSubmittedReview(
  review: TransactionReviewView,
  _variables: unknown,
  _onMutateResult: unknown,
  context: MutationFunctionContext,
): void {
  void context.client.setQueryData(transactionQueries.reviewKey(review.set.id), review);
}
