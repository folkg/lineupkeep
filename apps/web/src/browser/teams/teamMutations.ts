import { mutationOptions } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";

import type {
  TeamChangeView,
  TeamNoteSaveResult,
  TeamRefreshView,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";

import { teamQueries } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";

export const teamMutations = {
  control: (remote: TeamRemote) =>
    mutationOptions({
      mutationKey: ["teams", "control"],
      mutationFn: remote.control,
      onSuccess: storeRefreshedTeams,
    }),
  refresh: (remote: TeamRemote) =>
    mutationOptions({
      mutationKey: ["teams", "refresh"],
      mutationFn: remote.refresh,
      onSuccess: storeRefreshedTeamList,
    }),
  saveNote: (remote: TeamRemote) =>
    mutationOptions({
      mutationKey: ["teams", "note"],
      mutationFn: remote.saveNote,
      onSuccess: storeSavedNote,
    }),
};

function storeSavedNote(
  saved: TeamNoteSaveResult,
  variables: { readonly team: string },
  _onMutateResult: unknown,
  context: MutationFunctionContext,
): void {
  if (saved.outcome !== "saved") {
    return;
  }
  context.client.setQueryData<ReadonlyArray<TeamSummaryView>>(teamQueries.listKey, (current) =>
    current?.map((summary) =>
      summary.team.id === variables.team
        ? {
            ...summary,
            team: {
              ...summary.team,
              ownerNote: saved.note,
              ownerNoteUpdatedAt: saved.updatedAt,
            },
          }
        : summary,
    ),
  );
}

function storeRefreshedTeams(
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
