import { useMutation, useQuery } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import type { TeamChangeView, TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { describeTeamFailure } from "./teamFailure";
import { storeRefreshedTeams, teamMutations } from "./teamMutations";
import type { TeamListQueryOptions } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";

export function useTeamsPage(props: TeamsPageOptions): TeamsPageController {
  const teams = useQuery(() => props.teamsQuery());
  const signIn = useSignInRecovery();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [pendingTeam, setPendingTeam] = createSignal<string>();

  const reportFailure = (error: unknown): void => {
    const failure = describeTeamFailure(error);
    setFeedback({
      type: "attention",
      message: failure.message,
      ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
    });
  };

  const setEnabled = useMutation(() => ({
    ...teamMutations.setEnabled(props.remote()),
    onSuccess: (change: TeamChangeView, variables, onMutateResult, context) => {
      storeRefreshedTeams(change, variables, onMutateResult, context);
      setFeedback({ type: "success", message: "Automation setting saved." });
    },
    onError: reportFailure,
    onSettled: () => setPendingTeam(undefined),
  }));
  const pause = useMutation(() => ({
    ...teamMutations.pause(props.remote()),
    onSuccess: (change: TeamChangeView, variables, onMutateResult, context) => {
      storeRefreshedTeams(change, variables, onMutateResult, context);
      setFeedback({ type: "success", message: "Paused for the rest of this fantasy day." });
    },
    onError: reportFailure,
    onSettled: () => setPendingTeam(undefined),
  }));

  const changeEnabled = (team: TeamSummaryView, enabled: boolean): void => {
    setPendingTeam(team.team.id);
    setFeedback({
      type: "pending",
      message: enabled ? "Enabling automation…" : "Disabling automation…",
    });
    void setEnabled.mutate({ team: team.team.id, enabled });
  };

  return {
    teams: () => teams.data,
    isLoading: () => teams.isPending,
    loadFailure: () => teams.error,
    feedback,
    pendingTeam,
    refresh: () => props.onRefresh(),
    setEnabled: changeEnabled,
    pause: (team) => {
      setPendingTeam(team.team.id);
      setFeedback({ type: "pending", message: "Pausing for the rest of this fantasy day…" });
      void pause.mutate({ team: team.team.id });
    },
  };
}

export type TeamsPageController = {
  readonly teams: Accessor<ReadonlyArray<TeamSummaryView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly pendingTeam: Accessor<string | undefined>;
  readonly refresh: () => Promise<void>;
  readonly setEnabled: (team: TeamSummaryView, enabled: boolean) => void;
  readonly pause: (team: TeamSummaryView) => void;
};

type TeamsPageOptions = {
  readonly teamsQuery: Accessor<TeamListQueryOptions>;
  readonly remote: Accessor<TeamRemote>;
  readonly onRefresh: () => Promise<void>;
};
