import { useMutation, useQuery } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import type { TeamRefreshView, TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { describeTeamFailure } from "./teamFailure";
import { storeRefreshedTeamList, teamMutations } from "./teamMutations";
import type { TeamListQueryOptions } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";

export function useTeamsPage(props: TeamsPageOptions): TeamsPageController {
  const teams = useQuery(() => props.teamsQuery());
  const signIn = useSignInRecovery();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [refreshing, setRefreshing] = createSignal(false);

  const reportRefreshFailure = (error: unknown): void => {
    const failure = describeTeamFailure(error);
    setFeedback({
      type: "attention",
      message: failure.message,
      ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
    });
  };

  const refreshTeams = useMutation(() => ({
    ...teamMutations.refresh(props.remote()),
    onSuccess: (view: TeamRefreshView, variables, onMutateResult, context) => {
      storeRefreshedTeamList(view, variables, onMutateResult, context);
      setFeedback({ type: "success", message: "Teams refreshed." });
    },
    onError: reportRefreshFailure,
    onSettled: () => setRefreshing(false),
  }));

  return {
    teams: () => teams.data,
    isLoading: () => teams.isPending,
    loadFailure: () => teams.error,
    feedback,
    refreshing,
    refresh: () => props.onRefresh(),
    refreshTeams: () => {
      setRefreshing(true);
      setFeedback({ type: "pending", message: "Refreshing teams…" });
      void refreshTeams.mutate(undefined);
    },
  };
}

export type TeamsPageController = {
  readonly teams: Accessor<ReadonlyArray<TeamSummaryView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly refreshing: Accessor<boolean>;
  readonly refresh: () => Promise<void>;
  readonly refreshTeams: () => void;
};

type TeamsPageOptions = {
  readonly teamsQuery: Accessor<TeamListQueryOptions>;
  readonly remote: Accessor<TeamRemote>;
  readonly onRefresh: () => Promise<void>;
};
