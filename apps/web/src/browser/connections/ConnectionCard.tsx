import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { Badge } from "#browser/brand-ui/Badge.tsx";
import { Entry } from "#browser/brand-ui/Entry.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import type { ConnectionView } from "#contracts/connections/connectionContract.ts";

export function ConnectionCard(props: ConnectionCardProps): JSX.Element {
  return (
    <Entry
      actions={
        <Inline gap="sm">
          <Show when={props.connection.status === "linking"}>
            <Button pending={props.approving} pendingLabel="Approving…" onClick={props.onApprove}>
              Approve helper
            </Button>
            <Button
              pending={props.canceling}
              pendingLabel="Cancelling…"
              variant="secondary"
              onClick={props.onCancel}
            >
              Cancel
            </Button>
          </Show>
          <Show
            when={
              props.connection.status === "ready" ||
              props.connection.status === "reconnect-required"
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
      }
      cue={statusLabel(props.connection.status)}
      editing={false}
      meta={<ConnectionMeta connection={props.connection} />}
    >
      <Heading level={3} size="item">
        Yahoo connection
      </Heading>
    </Entry>
  );
}

function ConnectionMeta(props: { readonly connection: ConnectionView }): JSX.Element {
  return (
    <Show
      fallback={
        <Show
          fallback={
            <Show
              fallback={
                <Text size="caption" tone="muted">
                  Connected. The provider session is ready for this account.
                </Text>
              }
              when={props.connection.status === "reconnect-required"}
            >
              <Text size="caption" tone="muted">
                This connection needs a new provider session. Reconnect the local helper to
                continue.
              </Text>
            </Show>
          }
          when={props.connection.status === "linking"}
        >
          <Text size="caption" tone="muted">
            Pairing code <Badge size="cue">{props.connection.pairingCode}</Badge>. Approve the
            helper after it shows this code.
            <Show when={props.connection.linkingExpiresAt}>
              {(expiresAt) => (
                <>
                  {" "}
                  This request expires at{" "}
                  <Time datetime={expiresAt()}>{expiryLabel(expiresAt())}</Time>.
                </>
              )}
            </Show>
          </Text>
        </Show>
      }
      when={props.connection.status === "disconnected"}
    >
      <Text size="caption" tone="muted">
        This connection is disconnected and no longer provides access.
      </Text>
    </Show>
  );
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

function expiryLabel(timestamp: string): string {
  return `${new Date(timestamp).toISOString().slice(11, 16)} UTC`;
}

type ConnectionCardProps = {
  readonly connection: ConnectionView;
  readonly approving: boolean;
  readonly canceling: boolean;
  readonly disconnecting: boolean;
  readonly onApprove: () => void;
  readonly onCancel: () => void;
  readonly onDisconnect: () => void;
};
