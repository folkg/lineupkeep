import { mutationOptions } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";

import type { TeamChangeView } from "#contracts/connections/teamContract.ts";

import { teamQueries } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";

export const teamMutations = {
  setEnabled: (remote: TeamRemote) =>
    mutationOptions({
      mutationKey: ["teams", "set-enabled"],
      mutationFn: remote.setEnabled,
      onSuccess: storeRefreshedTeams,
    }),
  pause: (remote: TeamRemote) =>
    mutationOptions({
      mutationKey: ["teams", "pause"],
      mutationFn: remote.pause,
      onSuccess: storeRefreshedTeams,
    }),
};

export function storeRefreshedTeams(
  change: TeamChangeView,
  _variables: unknown,
  _onMutateResult: unknown,
  context: MutationFunctionContext,
): void {
  void context.client.setQueryData(teamQueries.listKey, change.teams);
}
