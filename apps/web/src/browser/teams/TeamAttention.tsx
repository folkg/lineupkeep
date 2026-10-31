import type { JSX } from "@solidjs/web";
import { Match, Show, Switch } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import { providerDisplayName } from "#contracts/connections/providerLabels.ts";
import type { TeamSummaryView } from "#contracts/connections/teamContract.ts";

import type { TeamRemote } from "./teamRemote";
import { useTeamCheck } from "./useTeamCheck";

export function TeamAttention(props: TeamAttentionProps): JSX.Element {
  const provider = (): string => providerDisplayName(props.team.team.provider);
  const unavailable = (): UnavailableAvailability | undefined => {
    const availability = props.team.team.availability;
    return availability.status === "unavailable" ? availability : undefined;
  };
  const check = useTeamCheck({ team: () => props.team, remote: () => props.remote });

  return (
    <>
      <Show when={hasAttention(props.team)}>
        <Stack gap="xs">
          <Show when={unavailable()}>
            {(availability) => (
              <Stack gap="xs">
                <Text size="caption" weight="semibold">
                  Lineupkeep cannot read this team.
                </Text>
                <Text size="caption">{availability().detail}</Text>
                <Text size="caption" tone="muted">
                  Observed{" "}
                  <Time datetime={availability().observedAt}>
                    {formatReaderTime(availability().observedAt)}
                  </Time>
                  . Lineup checks skip it until it can be read.
                </Text>
                <Show when={props.team.connectionStatus === "ready"}>
                  <Inline gap="sm">
                    <Button
                      pending={check.checking()}
                      pendingLabel="Checking…"
                      variant="quiet"
                      onClick={check.check}
                    >
                      Check this team again
                    </Button>
                  </Inline>
                </Show>
              </Stack>
            )}
          </Show>
          <ConnectionAttention provider={provider()} status={props.team.connectionStatus} />
        </Stack>
      </Show>
      <Show when={check.feedback()}>{(state) => <ActionFeedback feedback={state()} />}</Show>
    </>
  );
}

function ConnectionAttention(props: {
  readonly provider: string;
  readonly status: TeamSummaryView["connectionStatus"];
}): JSX.Element {
  return (
    <Switch>
      <Match when={props.status === "reconnect-required"}>
        <Inline gap="sm">
          <Text as="span" size="caption">
            {props.provider} needs a new sign-in before lineup checks can run.
          </Text>
          <TextLink to="/connections">Reconnect {props.provider}</TextLink>
        </Inline>
      </Match>
      <Match when={props.status === "disconnected"}>
        <Inline gap="sm">
          <Text as="span" size="caption">
            {props.provider} is disconnected, so lineup checks cannot run.
          </Text>
          <TextLink to="/connections">Reconnect {props.provider}</TextLink>
        </Inline>
      </Match>
      <Match when={props.status === "linking"}>
        <Text size="caption">{props.provider} sign-in is in progress.</Text>
      </Match>
    </Switch>
  );
}

function hasAttention(team: TeamSummaryView): boolean {
  return team.connectionStatus !== "ready" || team.team.availability.status === "unavailable";
}

type TeamAttentionProps = {
  readonly team: TeamSummaryView;
  readonly remote: TeamRemote;
};

type UnavailableAvailability = Extract<
  TeamSummaryView["team"]["availability"],
  { readonly status: "unavailable" }
>;
