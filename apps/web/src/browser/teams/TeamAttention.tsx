import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import { providerDisplayName } from "#contracts/connections/providerLabels.ts";
import type { TeamSummaryView } from "#contracts/connections/teamContract.ts";

export function TeamAttention(props: TeamAttentionProps): JSX.Element {
  const provider = (): string => providerDisplayName(props.team.team.provider);

  return (
    <Show when={hasAttention(props.team)}>
      <Stack gap="xs">
        <Show when={props.team.connectionStatus === "reconnect-required"}>
          <Inline gap="sm">
            <Text as="span" size="caption">
              {provider()} needs a new sign-in before lineup checks can run.
            </Text>
            <TextLink to="/account">Reconnect {provider()}</TextLink>
          </Inline>
        </Show>
        <Show when={props.team.connectionStatus === "disconnected"}>
          <Inline gap="sm">
            <Text as="span" size="caption">
              {provider()} is disconnected, so lineup checks cannot run.
            </Text>
            <TextLink to="/account">Reconnect {provider()}</TextLink>
          </Inline>
        </Show>
        <Show when={props.team.connectionStatus === "linking"}>
          <Text size="caption">{provider()} sign-in is in progress.</Text>
        </Show>
      </Stack>
    </Show>
  );
}

function hasAttention(team: TeamSummaryView): boolean {
  return team.connectionStatus !== "ready";
}

type TeamAttentionProps = {
  readonly team: TeamSummaryView;
};
