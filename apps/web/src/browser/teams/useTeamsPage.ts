import { useMutation, useQuery } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import type {
  TeamChangeView,
  TeamControlData,
  TeamRefreshView,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";

import { describeTeamFailure } from "./teamFailure";
import { storeRefreshedTeamList, storeRefreshedTeams, teamMutations } from "./teamMutations";
import type { TeamListQueryOptions } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";

export function useTeamsPage(props: TeamsPageOptions): TeamsPageController {
  const teams = useQuery(() => props.teamsQuery());
  const signIn = useSignInRecovery();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [pendingTeam, setPendingTeam] = createSignal<string>();
  const [refreshing, setRefreshing] = createSignal(false);

  const reportFailure = (error: unknown): void => {
    const failure = describeTeamFailure(error);
    setFeedback({
      type: "attention",
      message: failure.message,
      ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
    });
  };

  const control = useMutation(() => ({
    ...teamMutations.control(props.remote()),
    onSuccess: (change: TeamChangeView, variables: TeamControlData, onMutateResult, context) => {
      storeRefreshedTeams(change, variables, onMutateResult, context);
      setFeedback({ type: "success", message: successMessage(variables.action) });
    },
    onError: reportFailure,
    onSettled: () => setPendingTeam(undefined),
  }));
  const refreshTeams = useMutation(() => ({
    ...teamMutations.refresh(props.remote()),
    onSuccess: (view: TeamRefreshView, variables, onMutateResult, context) => {
      storeRefreshedTeamList(view, variables, onMutateResult, context);
      setFeedback({ type: "success", message: "Teams refreshed from Yahoo." });
    },
    onError: reportFailure,
    onSettled: () => setRefreshing(false),
  }));

  const changeAutomation = (team: TeamSummaryView, action: TeamControlData["action"]): void => {
    setPendingTeam(team.team.id);
    setFeedback({ type: "pending", message: pendingMessage(action) });
    void control.mutate({ team: team.team.id, action });
  };

  return {
    teams: () => teams.data,
    isLoading: () => teams.isPending,
    loadFailure: () => teams.error,
    feedback,
    pendingTeam,
    refreshing,
    refresh: () => props.onRefresh(),
    refreshTeams: () => {
      setRefreshing(true);
      setFeedback({ type: "pending", message: "Refreshing teams from Yahoo…" });
      void refreshTeams.mutate(undefined);
    },
    setEnabled: (team, enabled) => changeAutomation(team, enabled ? "enable" : "disable"),
    pause: (team) => changeAutomation(team, "pause-today"),
    resume: (team) => changeAutomation(team, "resume"),
  };
}

export type TeamsPageController = {
  readonly teams: Accessor<ReadonlyArray<TeamSummaryView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly pendingTeam: Accessor<string | undefined>;
  readonly refreshing: Accessor<boolean>;
  readonly refresh: () => Promise<void>;
  readonly refreshTeams: () => void;
  readonly setEnabled: (team: TeamSummaryView, enabled: boolean) => void;
  readonly pause: (team: TeamSummaryView) => void;
  readonly resume: (team: TeamSummaryView) => void;
};

type TeamsPageOptions = {
  readonly teamsQuery: Accessor<TeamListQueryOptions>;
  readonly remote: Accessor<TeamRemote>;
  readonly onRefresh: () => Promise<void>;
};

function pendingMessage(action: TeamControlData["action"]): string {
  switch (action) {
    case "enable":
      return "Enabling automation…";
    case "disable":
      return "Disabling automation…";
    case "pause-today":
      return "Pausing for the rest of this fantasy day…";
    case "resume":
      return "Resuming automation…";
  }
}

function successMessage(action: TeamControlData["action"]): string {
  switch (action) {
    case "enable":
      return "Automation enabled.";
    case "disable":
      return "Automation disabled.";
    case "pause-today":
      return "Paused for the rest of this fantasy day.";
    case "resume":
      return "Automation resumed.";
  }
}
