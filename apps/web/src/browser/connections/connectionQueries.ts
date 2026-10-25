import { queryOptions } from "@tanstack/solid-query";
import type { QueryClient } from "@tanstack/solid-query";

import type { ConnectionRemote } from "./connectionRemote";

export const connectionQueries = {
  all: () => ["connections"] as const,
  listKey: ["connections", "list"] as const,
  list: (remote: Pick<ConnectionRemote, "list">) =>
    queryOptions({
      queryKey: ["connections", "list"] as const,
      queryFn: ({ signal }) => remote.list({ signal }),
    }),
};

export function refreshConnectionLists(queryClient: QueryClient): Promise<void> {
  return queryClient.refetchQueries(
    { queryKey: connectionQueries.all(), type: "active" },
    { throwOnError: true },
  );
}

export type ConnectionListQueryOptions = ReturnType<typeof connectionQueries.list>;
