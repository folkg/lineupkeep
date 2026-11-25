import { EffectArray, jsonValue } from "@lineupkeep/collections";
import { hydrate } from "@tanstack/query-core";
import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { persistQueryClientSubscribe } from "@tanstack/query-persist-client-core";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { Query, QueryClient } from "@tanstack/solid-query";

const storageKey = "lineupkeep.query-cache.v1";
const buster = "2026-11-24";
const maxAge = 24 * 60 * 60 * 1_000;

export function restoreTeamQueries(queryClient: QueryClient): void {
  if (typeof window === "undefined") {
    return;
  }
  const raw = window.localStorage.getItem(storageKey);
  if (raw === null) {
    return;
  }
  let persisted: unknown;
  try {
    persisted = jsonValue(raw);
  } catch {
    removePersistedTeamQueries();
    return;
  }
  if (!isPersistedClient(persisted) || !isCurrent(persisted)) {
    removePersistedTeamQueries();
    return;
  }
  const missing = EffectArray.filter(
    persisted.clientState.queries,
    (query) => queryClient.getQueryCache().get(query.queryHash) === undefined,
  );
  if (missing.length === 0) {
    return;
  }
  hydrate(queryClient, { ...persisted.clientState, mutations: [], queries: missing });
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
  window.localStorage.removeItem(storageKey);
}

function isCurrent(persisted: PersistedClient): boolean {
  return Date.now() - persisted.timestamp <= maxAge && persisted.buster === buster;
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

function isPersistedClient(value: unknown): value is PersistedClient {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (!("timestamp" in value) || typeof value.timestamp !== "number") {
    return false;
  }
  if (!("buster" in value) || typeof value.buster !== "string") {
    return false;
  }
  if (
    !("clientState" in value) ||
    typeof value.clientState !== "object" ||
    value.clientState === null
  ) {
    return false;
  }
  return (
    "queries" in value.clientState &&
    EffectArray.isArray(value.clientState.queries) &&
    "mutations" in value.clientState &&
    EffectArray.isArray(value.clientState.mutations)
  );
}
