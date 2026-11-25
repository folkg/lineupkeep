import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import type { ActionState } from "#browser/shared-ui/actionState.ts";
import { IconButton } from "#browser/shared-ui/IconButton.tsx";
import { PauseIcon, PlayIcon } from "#browser/shared-ui/icons.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Switch } from "#browser/shared-ui/Switch.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type {
  TeamControlData,
  TeamPendingAction,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";

import { pauseResumeLabel } from "./teamLabels";
import type { TeamRemote } from "./teamRemote";
import { useTeamControls } from "./useTeamControls";

const pauseLabel = "Pause lineup checks for the rest of the fantasy day";
const resumeLabel = "Resume lineup checks";
const turnOnFirst = "Turn on lineup checks to pause the rest of the fantasy day.";

export function TeamControls(props: TeamControlsProps): JSX.Element {
  const controls = useTeamControls({
    team: () => props.team,
    remote: () => props.remote,
    onOptimistic: (input) => props.onOptimistic(input),
  });
  const enabled = (): boolean => controls.automation().status !== "disabled";
  const paused = (): boolean => controls.automation().status === "paused-until-fantasy-day-end";
  const pendingAction = (): TeamPendingAction | undefined => props.team.pending?.action;
  const switchPending = (): boolean =>
    pendingAction() === "enable" || pendingAction() === "disable";
  const pausePending = (): boolean => pendingAction() === "pause" || pendingAction() === "resume";
  const switchState = (): ActionState => (switchPending() ? "working" : "idle");
  const pauseState = (): ActionState => (pausePending() ? "working" : "idle");

  return (
    <Stack gap="sm">
      <Inline gap="sm">
        <Switch
          compact={props.compact}
          checked={enabled()}
          disabled={pendingAction() !== undefined}
          name={`Lineup checks for ${props.team.team.name}`}
          state={switchState()}
          onToggle={() => controls.control(enabled() ? "disable" : "enable")}
        >
          Lineup checks
        </Switch>
        <IconButton
          disabled={!enabled() || pendingAction() !== undefined}
          label={paused() ? resumeLabel : pauseLabel}
          title={!enabled() ? turnOnFirst : undefined}
          state={pauseState()}
          onClick={() => controls.control(paused() ? "resume" : "pause-today")}
        >
          <Show fallback={<PauseIcon size="md" />} when={paused()}>
            <PlayIcon size="md" />
          </Show>
        </IconButton>
      </Inline>
      <Show when={props.showPauseNote !== false && pauseResumeLabel(controls.automation())}>
        {(note) => (
          <Text type="meta" tone="muted">
            {note()}
          </Text>
        )}
      </Show>
      <Show when={controls.feedback()}>{(state) => <ActionFeedback feedback={state()} />}</Show>
    </Stack>
  );
}

type TeamControlsProps = {
  readonly compact?: boolean;
  readonly showPauseNote?: boolean;
  readonly team: TeamSummaryView;
  readonly remote: TeamRemote;
  readonly onOptimistic: (input: TeamControlData) => void;
};
