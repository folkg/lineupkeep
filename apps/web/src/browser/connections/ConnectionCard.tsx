import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { Entry } from "#browser/brand-ui/Entry.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import type { ConnectionView } from "#contracts/connections/connectionContract.ts";

export function ConnectionCard(props: ConnectionCardProps): JSX.Element {
  return (
    <Entry
      actions={
        <Show when={props.connection.status === "linking"}>
          <Button
            pending={props.canceling}
            pendingLabel="Cancelling…"
            variant="secondary"
            onClick={props.onCancel}
          >
            Cancel link
          </Button>
        </Show>
      }
      cue={props.connection.status === "linking" ? "Linking" : "Disconnected"}
      editing={false}
      meta={
        <Show
          fallback={
            <Text size="caption" tone="muted">
              This connection is disconnected and no longer provides access.
            </Text>
          }
          when={props.connection.linkingExpiresAt}
        >
          {(expiresAt) => (
            <Text size="caption" tone="muted">
              Waiting for the local helper. This link expires at{" "}
              <Time datetime={expiresAt()}>{expiryLabel(expiresAt())}</Time>.
            </Text>
          )}
        </Show>
      }
    >
      <Heading level={3} size="item">
        Yahoo connection
      </Heading>
    </Entry>
  );
}

function expiryLabel(timestamp: string): string {
  return `${new Date(timestamp).toISOString().slice(11, 16)} UTC`;
}

type ConnectionCardProps = {
  readonly connection: ConnectionView;
  readonly canceling: boolean;
  readonly onCancel: () => void;
};
