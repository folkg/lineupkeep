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
import { teamAutomation } from "./teamPending";
import type { TeamRemote } from "./teamRemote";

export function useTeamControls(options: TeamControlsOptions): TeamControlsController {
  const signIn = useSignInRecovery();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();

  const control = useMutation(() => ({
    ...teamMutations.control(options.remote()),
    onMutate: (input: TeamControlData) => {
      options.onOptimistic(input);
    },
    onError: (error: Error) => {
      const failure = describeControlFailure(error);
      setFeedback({
        type: "attention",
        message: failure.message,
        ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
      });
    },
  }));

  return {
    automation: () => teamAutomation(options.team()),
    feedback,
    control: (action) => {
      if (options.team().pending !== undefined) {
        return;
      }
      setFeedback(undefined);
      void control.mutate({ team: options.team().team.id, action });
    },
  };
}

export type TeamControlsController = {
  readonly automation: Accessor<TeamAutomationView>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly control: (action: TeamControlData["action"]) => void;
};

type TeamControlsOptions = {
  readonly team: Accessor<TeamSummaryView>;
  readonly remote: Accessor<TeamRemote>;
  readonly onOptimistic: (input: TeamControlData) => void;
};
