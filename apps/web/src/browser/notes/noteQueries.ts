import { infiniteQueryOptions } from "@tanstack/solid-query";
import type { QueryClient } from "@tanstack/solid-query";

import type { NoteLifecycleView, NotePageView } from "#contracts/notes/noteContract.ts";

import type { NoteRemote } from "./noteRemote";

export const noteQueries = {
  all: () => ["notes"] as const,
  list: (remote: Pick<NoteRemote, "list">, filter: NoteListFilter) =>
    infiniteQueryOptions({
      queryKey: ["notes", "list", filter] as const,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (page: NotePageView) => page.nextCursor,
      queryFn: ({ signal, pageParam }): Promise<NotePageView> =>
        remote.list(
          {
            ...filter,
            ...(pageParam === undefined ? {} : { cursor: pageParam }),
          },
          { signal },
        ),
    }),
};

export function refreshNoteLists(queryClient: QueryClient): Promise<void> {
  return queryClient.refetchQueries(
    { queryKey: noteQueries.all(), type: "active" },
    { throwOnError: true },
  );
}

export type NoteListFilter = {
  readonly lifecycle: NoteLifecycleView;
  readonly search?: string;
};

export type NoteListQueryOptions = ReturnType<typeof noteQueries.list>;
