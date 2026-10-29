import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { Button } from "#browser/shared-ui/Button.tsx";
import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import type { ConnectionView } from "#contracts/connections/connectionContract.ts";
import { providerDisplayName } from "#contracts/connections/providerLabels.ts";

export function ConnectionCard(props: ConnectionCardProps): JSX.Element {
  return (
    <RuleListItem layout="columns">
      <Stack gap="sm">
        <Inline gap="sm">
          <Heading level={3} size="item">
            {providerDisplayName(props.connection.provider)} connection
          </Heading>
          <Text size="caption" tone="faint" weight="semibold">
            {statusLabel(props.connection.status)}
          </Text>
        </Inline>
        <ConnectionIdentity connection={props.connection} />
        <Text size="caption" tone="muted">
          {capabilityLabel(props.connection.status)}
        </Text>
        <Show when={props.connection.linkingExpiresAt}>
          {(expiresAt) => (
            <Text size="caption" tone="faint">
              This sign-in request expires{" "}
              <Time datetime={expiresAt()}>{formatReaderTime(expiresAt())}</Time>.
            </Text>
          )}
        </Show>
      </Stack>
      <Inline gap="sm">
        <Show when={props.connection.status === "reconnect-required"}>
          <Button
            pending={props.reconnecting}
            pendingLabel="Opening sign-in…"
            onClick={props.onReconnect}
          >
            Reconnect
          </Button>
        </Show>
        <Show
          when={
            props.connection.status === "ready" || props.connection.status === "reconnect-required"
          }
        >
          <Button
            pending={props.disconnecting}
            pendingLabel="Disconnecting…"
            variant="secondary"
            onClick={props.onDisconnect}
          >
            Disconnect
          </Button>
        </Show>
      </Inline>
    </RuleListItem>
  );
}

function ConnectionIdentity(props: { readonly connection: ConnectionView }): JSX.Element {
  const timestamp = (): string => props.connection.approvedAt ?? props.connection.createdAt;
  const label = (): string => (props.connection.approvedAt === undefined ? "Started" : "Connected");

  return (
    <Text size="caption">
      {teamCountLabel(props.connection.teamCount)} · {label()}{" "}
      <Time datetime={timestamp()}>{formatReaderTime(timestamp())}</Time>
    </Text>
  );
}

function teamCountLabel(teamCount: number): string {
  return teamCount === 1 ? "1 team" : `${teamCount} teams`;
}

function capabilityLabel(status: ConnectionView["status"]): string {
  switch (status) {
    case "ready":
      return "Can read and set lineups for these teams.";
    case "reconnect-required":
      return "Cannot read or set lineups until you sign in again.";
    case "linking":
      return "Waiting for the sign-in to finish.";
    case "disconnected":
      return "Cannot read or change teams through this connection.";
  }
}

function statusLabel(status: ConnectionView["status"]): string {
  switch (status) {
    case "linking":
      return "Linking";
    case "ready":
      return "Connected";
    case "reconnect-required":
      return "Reconnect required";
    case "disconnected":
      return "Disconnected";
  }
}

type ConnectionCardProps = {
  readonly connection: ConnectionView;
  readonly disconnecting: boolean;
  readonly reconnecting: boolean;
  readonly onDisconnect: () => void;
  readonly onReconnect: () => void;
};
