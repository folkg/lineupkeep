import { useMutation } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import { defaultProviderName } from "#contracts/connections/providerLabels.ts";
import type { TeamRefreshView, TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { describeCheckFailure } from "./teamFailure";
import { storeRefreshedTeamList, teamMutations } from "./teamMutations";
import type { TeamRemote } from "./teamRemote";

export function useTeamCheck(props: TeamCheckOptions): TeamCheckController {
  const signIn = useSignInRecovery();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();

  const check = useMutation(() => ({
    ...teamMutations.check(props.remote()),
    onSuccess: (view: TeamRefreshView, variables, onMutateResult, context) => {
      storeRefreshedTeamList(view, variables, onMutateResult, context);
      setFeedback(checkFeedback(view.teams, variables.team));
    },
    onError: (error: Error) => {
      const failure = describeCheckFailure(error);
      setFeedback({
        type: "attention",
        message: failure.message,
        ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
      });
    },
  }));

  return {
    checking: () => check.isPending,
    feedback,
    check: () => {
      setFeedback({
        type: "pending",
        message: `Checking this team with ${defaultProviderName()}…`,
      });
      void check.mutate({ team: props.team().team.id });
    },
  };
}

function checkFeedback(teams: ReadonlyArray<TeamSummaryView>, teamId: string): ActionFeedbackState {
  const checked = teams.find((team) => team.team.id === teamId)?.team.availability;
  if (checked === undefined || checked.status === "available") {
    return {
      type: "success",
      message: `Checked. ${defaultProviderName()} reads this team, so lineup checks can run again.`,
    };
  }
  return {
    type: "attention",
    message: `Checked. Lineupkeep still cannot read this team. ${checked.detail}`,
  };
}

export type TeamCheckController = {
  readonly checking: Accessor<boolean>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly check: () => void;
};

type TeamCheckOptions = {
  readonly team: Accessor<TeamSummaryView>;
  readonly remote: Accessor<TeamRemote>;
};
