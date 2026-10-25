import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { Badge } from "#browser/brand-ui/Badge.tsx";
import { Entry } from "#browser/brand-ui/Entry.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextField } from "#browser/shared-ui/TextField.tsx";
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
      meta={
        <Stack gap="md">
          <ConnectionMeta connection={props.connection} />
          <Show when={props.connection.status === "reconnect-required"}>
            <ReconnectForm
              code={props.reconnectCode}
              pending={props.reconnecting}
              onChange={props.onChangeReconnectCode}
              onStart={props.onReconnect}
            />
          </Show>
        </Stack>
      }
    >
      <Heading level={3} size="item">
        Yahoo connection
      </Heading>
    </Entry>
  );
}

function ReconnectForm(props: {
  readonly code: string;
  readonly pending: boolean;
  readonly onChange: (value: string) => void;
  readonly onStart: () => void;
}): JSX.Element {
  return (
    <Form gap="sm" onSubmit={props.onStart}>
      <Text size="caption" tone="muted">
        Run the Lineupkeep helper again, enter the new pairing code here, and finish the Yahoo
        sign-in. The helper uploads the new session; enrollment stays unchanged.
      </Text>
      <TextField
        autocomplete="off"
        autocapitalize="characters"
        label="Reconnect pairing code"
        spellcheck={false}
        value={props.code}
        onInput={(event) => props.onChange(event.currentTarget.value)}
      />
      <Button pending={props.pending} pendingLabel="Starting reconnect…" type="submit">
        Start reconnect
      </Button>
    </Form>
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
  readonly reconnecting: boolean;
  readonly onApprove: () => void;
  readonly onCancel: () => void;
  readonly onDisconnect: () => void;
  readonly reconnectCode: string;
  readonly onChangeReconnectCode: (value: string) => void;
  readonly onReconnect: () => void;
};
