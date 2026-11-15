import { infiniteQueryOptions, queryOptions } from "@tanstack/solid-query";

import type { TransactionRemote } from "./transactionRemote";

export const transactionQueries = {
  all: () => ["transactions"] as const,
  timelineAll: () => ["transactions", "timeline"] as const,
  timeline: (remote: Pick<TransactionRemote, "timeline">) =>
    infiniteQueryOptions({
      queryKey: transactionQueries.timelineAll(),
      queryFn: ({ pageParam, signal }) =>
        remote.timeline(pageParam === undefined ? {} : { after: pageParam }, { signal }),
      initialPageParam: undefined as
        | {
            readonly runDay: string | null;
            readonly team: string;
            readonly position: number;
            readonly move: string;
          }
        | undefined,
      getNextPageParam: (last) => last.page.next,
      staleTime: 0,
      refetchOnMount: false,
    }),
  listAll: () => ["transactions", "list"] as const,
  listKey: (team: string | undefined, state: "today" | "saved" | "ended") =>
    ["transactions", "list", team ?? "*", state] as const,
  list: (
    remote: Pick<TransactionRemote, "list">,
    input: {
      readonly team?: string;
      readonly state?: "today" | "saved" | "ended";
      readonly limit?: number;
    },
  ) => {
    const state = input.state ?? "today";
    return infiniteQueryOptions({
      queryKey: transactionQueries.listKey(input.team, state),
      queryFn: ({ pageParam, signal }) =>
        remote.list(
          {
            ...(input.team === undefined ? {} : { team: input.team }),
            state,
            ...(pageParam === undefined ? {} : { after: pageParam }),
            ...(input.limit === undefined ? {} : { limit: input.limit }),
          },
          { signal },
        ),
      initialPageParam: undefined as
        | {
            readonly runDay: string | null;
            readonly team: string;
            readonly position: number;
            readonly move: string;
          }
        | undefined,
      getNextPageParam: (last) => last.page.next,
      staleTime: 0,
      refetchOnMount: false,
    });
  },
  openCountKey: ["transactions", "open-count"] as const,
  openCount: (remote: Pick<TransactionRemote, "list">) =>
    queryOptions({
      queryKey: transactionQueries.openCountKey,
      queryFn: ({ signal }) =>
        remote.list({ state: "today", limit: 1 }, { signal }).then((data) => data.counts.open),
    }),
};
