import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Switch } from "#browser/shared-ui/Switch.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { pauseResumeLabel } from "./teamLabels";
import type { TeamRemote } from "./teamRemote";
import { useTeamControls } from "./useTeamControls";

export function TeamControls(props: TeamControlsProps): JSX.Element {
  const controls = useTeamControls({ team: () => props.team, remote: () => props.remote });
  const enabled = (): boolean => controls.automation().status !== "disabled";
  const paused = (): boolean => controls.automation().status === "paused-until-fantasy-day-end";
  const switchPending = (): boolean =>
    controls.pendingAction() === "enable" || controls.pendingAction() === "disable";
  const pausePending = (): boolean =>
    controls.pendingAction() === "pause-today" || controls.pendingAction() === "resume";

  return (
    <Stack gap="sm" align="start">
      <Switch
        busy={controls.pendingAction() !== undefined}
        checked={enabled()}
        name={`Lineup checks for ${props.team.team.name}`}
        onToggle={() => controls.control(enabled() ? "disable" : "enable")}
      >
        Lineup checks
      </Switch>
      <Show when={switchPending()}>
        <Text role="status" size="caption" tone="muted">
          {controls.pendingAction() === "disable" ? "Turning off…" : "Turning on…"}
        </Text>
      </Show>
      <Show when={pauseResumeLabel(controls.automation())}>
        {(note) => (
          <Text size="caption" tone="muted">
            {note()}
          </Text>
        )}
      </Show>
      <Show when={enabled()}>
        <Button
          disabled={controls.pendingAction() !== undefined && !pausePending()}
          pending={pausePending()}
          pendingLabel={controls.pendingAction() === "resume" ? "Resuming…" : "Pausing…"}
          variant="quiet"
          onClick={() => controls.control(paused() ? "resume" : "pause-today")}
        >
          {paused() ? "Resume lineup checks" : "Pause for the rest of the fantasy day"}
        </Button>
      </Show>
      <Show when={controls.feedback()}>{(state) => <ActionFeedback feedback={state()} />}</Show>
    </Stack>
  );
}

type TeamControlsProps = {
  readonly team: TeamSummaryView;
  readonly remote: TeamRemote;
};
