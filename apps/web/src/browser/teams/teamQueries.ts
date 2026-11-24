import { queryOptions } from "@tanstack/solid-query";
import type { QueryClient } from "@tanstack/solid-query";

import type { TeamRemote } from "./teamRemote";

export const teamQueries = {
  all: () => ["teams"] as const,
  listKey: ["teams", "list"] as const,
  cardsKey: ["teams", "card-facts"] as const,
  list: (remote: Pick<TeamRemote, "list">) =>
    queryOptions({
      queryKey: ["teams", "list"] as const,
      queryFn: ({ signal }) => remote.list({ signal }),
      gcTime: 24 * 60 * 60 * 1_000,
    }),
  cards: (remote: Pick<TeamRemote, "cards">) =>
    queryOptions({
      queryKey: ["teams", "card-facts"] as const,
      queryFn: ({ signal }) => remote.cards({ signal }),
      gcTime: 24 * 60 * 60 * 1_000,
      throwOnError: false,
    }),
  runKey: (run: string) => ["runs", "detail", run] as const,
  run: (remote: Pick<TeamRemote, "readRun">, run: string) =>
    queryOptions({
      queryKey: ["runs", "detail", run] as const,
      queryFn: () => remote.readRun({ run }),
    }),
};

export function refreshTeamLists(queryClient: QueryClient): Promise<void> {
  return queryClient.refetchQueries(
    { queryKey: teamQueries.all(), type: "active" },
    { throwOnError: true },
  );
}

export type TeamListQueryOptions = ReturnType<typeof teamQueries.list>;
export type TeamRunQueryOptions = ReturnType<typeof teamQueries.run>;
