import { queryOptions } from "@tanstack/solid-query";

import type { TransactionRemote } from "./transactionRemote";

export const transactionQueries = {
  all: () => ["transactions"] as const,
  reviewKey: (setId: string) => ["transactions", "review", setId] as const,
  review: (remote: Pick<TransactionRemote, "read">, setId: string) =>
    queryOptions({
      queryKey: transactionQueries.reviewKey(setId),
      queryFn: ({ signal }) => remote.read({ set: setId }, { signal }),
      staleTime: 0,
      refetchOnMount: false,
    }),
};

export type TransactionReviewQueryOptions = ReturnType<typeof transactionQueries.review>;
