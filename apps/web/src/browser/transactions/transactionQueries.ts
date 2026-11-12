import { infiniteQueryOptions, queryOptions } from "@tanstack/solid-query";

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
  listAll: () => ["transactions", "list"] as const,
  listKey: (team: string, state: "open" | "closed" = "open") =>
    ["transactions", "list", team, state] as const,
  list: (
    remote: Pick<TransactionRemote, "list">,
    input: {
      readonly team: string;
      readonly state?: "open" | "closed";
      readonly limit?: number;
    },
  ) => {
    const state = input.state ?? "open";
    return infiniteQueryOptions({
      queryKey: transactionQueries.listKey(input.team, state),
      queryFn: ({ pageParam, signal }) =>
        remote.list(
          {
            team: input.team,
            state,
            ...(pageParam === undefined ? {} : { cursor: pageParam }),
            ...(input.limit === undefined ? {} : { limit: input.limit }),
          },
          { signal },
        ),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.page.next,
      staleTime: 0,
      refetchOnMount: false,
    });
  },
};

export type TransactionReviewQueryOptions = ReturnType<typeof transactionQueries.review>;
export type TransactionProposalListQueryOptions = ReturnType<typeof transactionQueries.list>;
