import { useMutation, useQuery } from "@tanstack/solid-query";
import { createOptimisticStore, createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import { actionState } from "#browser/shared-ui/actionState.ts";
import type { ActionState } from "#browser/shared-ui/actionState.ts";
import type { TeamControlData, TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { describeTeamFailure } from "./teamFailure";
import { storeRefreshedTeamList, teamMutations } from "./teamMutations";
import { pendingControlAction, pendingValues } from "./teamPending";
import type { TeamListQueryOptions } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";

export function useTeamsPage(props: TeamsPageOptions): TeamsPageController {
  const query = useQuery(() => props.teamsQuery());
  const signIn = useSignInRecovery();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [refreshFinished, setRefreshFinished] = createSignal(false);
  const [teamList, setTeamList] = createOptimisticStore<TeamData[]>(
    () => (query.isSuccess ? [...query.data] : []),
    [],
    { key: null },
  );

  const refreshing = (): boolean => teamList.some((team) => team.pending?.action === "refresh");

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
    onMutate: () => {
      setTeamList((current) => {
        for (const team of current) {
          team.pending ??= pendingValues(team, "refresh");
        }
      });
    },
    onSuccess: (view, variables, onMutateResult, context) => {
      storeRefreshedTeamList(view, variables, onMutateResult, context);
      setRefreshFinished(true);
    },
    onError: reportRefreshFailure,
  }));

  return {
    teams: () => teamList,
    isLoading: () => query.isPending,
    loadFailure: () => query.error,
    dataUpdatedAt: () => query.dataUpdatedAt,
    feedback,
    refreshState: (): ActionState => actionState(refreshing(), refreshFinished()),
    refresh: () => props.onRefresh(),
    refreshTeams: () => {
      if (teamList.some((team) => team.pending !== undefined)) {
        return;
      }
      setRefreshFinished(false);
      setFeedback(undefined);
      void refreshTeams.mutate(undefined);
    },
    beginControl: (input) => {
      setTeamList((current) => {
        const target = current.find((team) => team.team.id === input.team);
        if (target === undefined || target.pending !== undefined) {
          return;
        }
        target.pending = pendingValues(target, pendingControlAction(input.action));
      });
    },
  };
}

export type TeamsPageController = {
  readonly teams: Accessor<ReadonlyArray<TeamSummaryView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly dataUpdatedAt: Accessor<number>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly refreshState: Accessor<ActionState>;
  readonly refresh: () => Promise<void>;
  readonly refreshTeams: () => void;
  readonly beginControl: (input: TeamControlData) => void;
};

type TeamsPageOptions = {
  readonly teamsQuery: () => TeamListQueryOptions;
  readonly remote: () => TeamRemote;
  readonly onRefresh: () => Promise<void>;
};

type TeamData = { -readonly [K in keyof TeamSummaryView]: TeamSummaryView[K] };
