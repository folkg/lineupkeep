import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { IconButton } from "#browser/shared-ui/IconButton.tsx";
import { PauseIcon, PlayIcon } from "#browser/shared-ui/icons.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Switch } from "#browser/shared-ui/Switch.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { pauseResumeLabel } from "./teamLabels";
import { TeamProviderLink } from "./TeamProviderLink";
import type { TeamRemote } from "./teamRemote";
import { useTeamControls } from "./useTeamControls";

const pauseLabel = "Pause lineup checks for the rest of the fantasy day";
const resumeLabel = "Resume lineup checks";
const waitForSwitch = "Wait for the lineup checks change to finish before pausing.";
const turnOnFirst = "Turn on lineup checks to pause the rest of the fantasy day.";

export function TeamControls(props: TeamControlsProps): JSX.Element {
  const controls = useTeamControls({ team: () => props.team, remote: () => props.remote });
  const enabled = (): boolean => controls.automation().status !== "disabled";
  const paused = (): boolean => controls.automation().status === "paused-until-fantasy-day-end";
  const switchPending = (): boolean =>
    controls.pendingAction() === "enable" || controls.pendingAction() === "disable";
  const pausePending = (): boolean =>
    controls.pendingAction() === "pause-today" || controls.pendingAction() === "resume";
  const resumeAction = (): boolean =>
    controls.pendingAction() === "resume"
      ? true
      : controls.pendingAction() === "pause-today"
        ? false
        : paused();

  return (
    <Stack gap="sm">
      <Inline gap="sm" justify={props.align === "end" ? "end" : undefined}>
        <Switch
          busy={controls.pendingAction() !== undefined}
          compact={props.compact}
          checked={enabled()}
          name={`Lineup checks for ${props.team.team.name}`}
          onToggle={() => controls.control(enabled() ? "disable" : "enable")}
        >
          Lineup checks
        </Switch>
        <IconButton
          busy={pausePending()}
          disabled={!enabled() || (controls.pendingAction() !== undefined && !pausePending())}
          label={resumeAction() ? resumeLabel : pauseLabel}
          title={
            !enabled()
              ? turnOnFirst
              : controls.pendingAction() !== undefined && !pausePending()
                ? waitForSwitch
                : undefined
          }
          onClick={() => controls.control(resumeAction() ? "resume" : "pause-today")}
        >
          <Show fallback={<PauseIcon size="md" />} when={resumeAction()}>
            <PlayIcon size="md" />
          </Show>
        </IconButton>
        <Show when={props.showProvider !== false}>
          <TeamProviderLink team={props.team.team} />
        </Show>
      </Inline>
      <Show when={switchPending()}>
        <Text role="status" size="caption" tone="muted">
          {controls.pendingAction() === "disable" ? "Turning off…" : "Turning on…"}
        </Text>
      </Show>
      <Show when={pausePending()}>
        <Text role="status" size="caption" tone="muted">
          {controls.pendingAction() === "resume" ? "Resuming…" : "Pausing…"}
        </Text>
      </Show>
      <Show
        when={
          props.showPauseNote !== false &&
          !pausePending() &&
          pauseResumeLabel(controls.automation())
        }
      >
        {(note) => (
          <Text size="caption" tone="muted">
            {note()}
          </Text>
        )}
      </Show>
      <Show when={controls.feedback()}>{(state) => <ActionFeedback feedback={state()} />}</Show>
    </Stack>
  );
}

type TeamControlsProps = {
  readonly align?: "start" | "end";
  readonly compact?: boolean;
  readonly showPauseNote?: boolean;
  readonly showProvider?: boolean;
  readonly team: TeamSummaryView;
  readonly remote: TeamRemote;
};
