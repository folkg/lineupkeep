import { persistQueryClientSubscribe } from "@tanstack/query-persist-client-core";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { Query, QueryClient } from "@tanstack/solid-query";

import { clearTeamCardSnapshot } from "./teamCardSnapshot.ts";

const storageKey = "lineupkeep.query-cache.v1";
const buster = "2026-11-24";
const maxAge = 24 * 60 * 60 * 1_000;

export async function restoreTeamQueries(queryClient: QueryClient): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  const persister = createPersister();
  try {
    const persisted = await persister.restoreClient();
    if (
      persisted === undefined ||
      persisted.buster !== buster ||
      Date.now() - persisted.timestamp > maxAge
    ) {
      removePersistedTeamQueries();
      return;
    }
    for (const query of persisted.clientState.queries) {
      if (query.state.data === undefined || query.queryKey[0] !== "teams") {
        continue;
      }
      if (queryClient.getQueryData(query.queryKey) === undefined) {
        queryClient.setQueryData(query.queryKey, query.state.data, {
          updatedAt: query.state.dataUpdatedAt,
        });
      }
    }
  } catch {
    removePersistedTeamQueries();
  }
}

export function persistTeamQueries(queryClient: QueryClient): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  return persistQueryClientSubscribe({
    queryClient,
    persister: createPersister(),
    buster,
    dehydrateOptions: { shouldDehydrateQuery: isTeamQuery },
  });
}

export function removePersistedTeamQueries(): void {
  if (typeof window === "undefined") {
    return;
  }
  clearTeamCardSnapshot();
  void createPersister().removeClient();
}

function createPersister(): ReturnType<typeof createSyncStoragePersister> {
  return createSyncStoragePersister({
    storage: window.localStorage,
    key: storageKey,
    throttleTime: 100,
  });
}

function isTeamQuery(query: Query): boolean {
  return query.queryKey[0] === "teams" && query.state.status === "success";
}
