import { queryOptions } from "@tanstack/solid-query";
import type { QueryClient } from "@tanstack/solid-query";

import type { FeedbackRemote } from "./feedbackRemote";

export const feedbackQueries = {
  all: () => ["feedback"] as const,
  listKey: ["feedback", "list"] as const,
  list: (remote: Pick<FeedbackRemote, "list">) =>
    queryOptions({
      queryKey: ["feedback", "list"] as const,
      queryFn: ({ signal }) => remote.list({ signal }),
    }),
};

export function refreshFeedbackReports(queryClient: QueryClient): Promise<void> {
  return queryClient.refetchQueries(
    { queryKey: feedbackQueries.all(), type: "active" },
    { throwOnError: true },
  );
}

export type FeedbackListQueryOptions = ReturnType<typeof feedbackQueries.list>;
