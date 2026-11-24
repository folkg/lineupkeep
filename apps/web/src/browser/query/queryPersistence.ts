import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
} from "@tanstack/query-persist-client-core";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { Query, QueryClient } from "@tanstack/solid-query";

const storageKey = "lineupkeep.query-cache.v1";
const buster = "2026-11-24";
const maxAge = 24 * 60 * 60 * 1_000;

export async function restoreTeamQueries(queryClient: QueryClient): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }
  await persistQueryClientRestore({
    queryClient,
    persister: createPersister(),
    buster,
    maxAge,
  });
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
