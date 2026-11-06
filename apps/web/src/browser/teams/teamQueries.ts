import { queryOptions } from "@tanstack/solid-query";
import type { QueryClient } from "@tanstack/solid-query";

import type { TeamRemote } from "./teamRemote";

export const teamQueries = {
  all: () => ["teams"] as const,
  listKey: ["teams", "list"] as const,
  list: (remote: Pick<TeamRemote, "list">) =>
    queryOptions({
      queryKey: ["teams", "list"] as const,
      queryFn: ({ signal }) => remote.list({ signal }),
    }),
  runKey: (run: string) => ["runs", "detail", run] as const,
  run: (remote: Pick<TeamRemote, "readRun">, run: string) =>
    queryOptions({
      queryKey: ["runs", "detail", run] as const,
      queryFn: () => remote.readRun({ run }),
    }),
  attentionKey: (team: string) => ["teams", "attention", team] as const,
  attention: (remote: Pick<TeamRemote, "readAttention">, team: string) =>
    queryOptions({
      queryKey: ["teams", "attention", team] as const,
      queryFn: () => remote.readAttention({ team }),
      retry: false,
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
