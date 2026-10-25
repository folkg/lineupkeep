import { mutationOptions } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";

import type { TeamChangeView, TeamRefreshView } from "#contracts/connections/teamContract.ts";

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
  refresh: (remote: TeamRemote) =>
    mutationOptions({
      mutationKey: ["teams", "refresh"],
      mutationFn: remote.refresh,
      onSuccess: storeRefreshedTeamList,
    }),
};

export function storeRefreshedTeams(
  change: TeamChangeView,
  _variables: unknown,
  _onMutateResult: unknown,
  context: MutationFunctionContext,
): void {
  storeRefreshedTeamList(change, _variables, _onMutateResult, context);
}

export function storeRefreshedTeamList(
  view: TeamRefreshView,
  _variables: unknown,
  _onMutateResult: unknown,
  context: MutationFunctionContext,
): void {
  void context.client.setQueryData(teamQueries.listKey, view.teams);
}
