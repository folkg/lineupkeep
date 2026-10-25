import { mutationOptions } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";

import type { ConnectionChangeView } from "#contracts/connections/connectionContract.ts";

import { connectionQueries } from "./connectionQueries";
import type { ConnectionRemote } from "./connectionRemote";

export const connectionMutations = {
  start: (remote: ConnectionRemote) =>
    mutationOptions({
      mutationKey: ["connections", "start"],
      mutationFn: remote.start,
      onSuccess: storeRefreshedConnections,
    }),
  approve: (remote: ConnectionRemote) =>
    mutationOptions({
      mutationKey: ["connections", "approve"],
      mutationFn: remote.approve,
      onSuccess: storeRefreshedConnections,
    }),
  cancel: (remote: ConnectionRemote) =>
    mutationOptions({
      mutationKey: ["connections", "cancel"],
      mutationFn: remote.cancel,
      onSuccess: storeRefreshedConnections,
    }),
  disconnect: (remote: ConnectionRemote) =>
    mutationOptions({
      mutationKey: ["connections", "disconnect"],
      mutationFn: remote.disconnect,
      onSuccess: storeRefreshedConnections,
    }),
};

export function storeRefreshedConnections(
  change: ConnectionChangeView,
  _variables: unknown,
  _onMutateResult: unknown,
  context: MutationFunctionContext,
): void {
  void context.client.setQueryData(connectionQueries.listKey, change.connections);
}
