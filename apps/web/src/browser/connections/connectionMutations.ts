import { mutationOptions } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";

import type { ConnectionChangeView } from "#contracts/connections/connectionContract.ts";

import { connectionQueries } from "./connectionQueries";
import type { ConnectionRemote } from "./connectionRemote";

export const connectionMutations = {
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
