import { useMutation } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import type {
  TeamAutomationView,
  TeamControlData,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";

import { describeControlFailure } from "./teamFailure";
import { teamMutations } from "./teamMutations";
import type { TeamRemote } from "./teamRemote";

export function useTeamControls(props: TeamControlsOptions): TeamControlsController {
  const signIn = useSignInRecovery();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();

  const control = useMutation(() => ({
    ...teamMutations.control(props.remote()),
    onError: (error: Error) => {
      const failure = describeControlFailure(error);
      setFeedback({
        type: "attention",
        message: failure.message,
        ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
      });
    },
  }));

  const automation = (): TeamAutomationView =>
    control.isPending && control.variables !== undefined
      ? optimisticAutomation(props.team().team.automation, control.variables.action)
      : props.team().team.automation;

  return {
    automation,
    pendingAction: () => (control.isPending ? control.variables?.action : undefined),
    feedback,
    control: (action) => {
      setFeedback(undefined);
      void control.mutate({ team: props.team().team.id, action });
    },
  };
}

function optimisticAutomation(
  current: TeamAutomationView,
  next: TeamControlData["action"],
): TeamAutomationView {
  switch (next) {
    case "enable":
    case "resume":
      return { status: "enabled", changedAt: current.changedAt };
    case "disable":
      return { status: "disabled", changedAt: current.changedAt };
    case "pause-today":
      return { status: "paused-until-fantasy-day-end", changedAt: current.changedAt };
  }
}

export type TeamControlsController = {
  readonly automation: Accessor<TeamAutomationView>;
  readonly pendingAction: Accessor<TeamControlData["action"] | undefined>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly control: (action: TeamControlData["action"]) => void;
};

type TeamControlsOptions = {
  readonly team: Accessor<TeamSummaryView>;
  readonly remote: Accessor<TeamRemote>;
};
