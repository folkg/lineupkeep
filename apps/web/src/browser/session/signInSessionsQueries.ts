import { queryOptions } from "@tanstack/solid-query";
import type { QueryClient } from "@tanstack/solid-query";

import type { SignInSessionsRemote } from "./signInSessionsRemote";

export const signInSessionsQueries = {
  listKey: ["sign-in-sessions", "list"] as const,
  list: (remote: Pick<SignInSessionsRemote, "list">) =>
    queryOptions({
      queryKey: ["sign-in-sessions", "list"] as const,
      queryFn: ({ signal }) => remote.list({ signal }),
    }),
};

export type SignInSessionListQueryOptions = ReturnType<typeof signInSessionsQueries.list>;

export function refreshSignInSessions(queryClient: QueryClient): Promise<void> {
  return queryClient.refetchQueries(
    { queryKey: signInSessionsQueries.listKey, type: "active" },
    { throwOnError: true },
  );
}
