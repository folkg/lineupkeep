import { EffectArray, EffectOption } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { Show, onSettled } from "solid-js";
import type { Accessor } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { ConnectionView } from "#contracts/connections/connectionContract.ts";
import { providerDisplayName } from "#contracts/connections/providerLabels.ts";

import { ConnectionList } from "./ConnectionList";
import type { ConnectionListQueryOptions } from "./connectionQueries";
import type { ConnectionRemote } from "./connectionRemote";
import { GoogleSignInNote } from "./GoogleSignInNote";
import { HostedBrowserPanel } from "./HostedBrowserPanel";
import { useConnectionsPage } from "./useConnectionsPage";
import { useHostedLinking } from "./useHostedLinking";

export function ConnectionsSection(props: ConnectionsSectionProps): JSX.Element {
  const page = useConnectionsPage({
    connectionsQuery: () => props.connectionsQuery(),
    remote: () => props.remote,
    onRefresh: () => props.onRefresh(),
  });
  const hosted = useHostedLinking({
    remote: () => props.remote,
    onRefresh: () => props.onRefresh(),
  });
  const hasConnection = (): boolean => page.connections().length > 0;
  const reconnectable = (): ConnectionView | undefined =>
    EffectOption.getOrUndefined(
      EffectArray.findFirst(
        page.connections(),
        (connection) => connection.status === "reconnect-required",
      ),
    );
  let startedFromLink = false;
  onSettled(() => {
    if (startedFromLink || props.connect === undefined || typeof window === "undefined") {
      return;
    }
    startedFromLink = true;
    void hosted.start({
      provider: props.connect,
      ...(props.connection === undefined ? {} : { connectionId: props.connection }),
    });
  });

  return (
    <Stack as="section" gap="md" labelledBy="connections-title">
      <SectionTitle id="connections-title">Connections</SectionTitle>
      <Text type="meta" tone="muted">
        Lineupgrade keeps the encrypted sign-in session, not your password.
      </Text>
      <Show when={hosted.session() === undefined}>
        <GoogleSignInNote />
      </Show>
      <Show when={hasConnection() && hosted.session() === undefined}>
        <Inline gap="sm">
          <Show when={reconnectable()}>
            {(connection) => (
              <Button onClick={() => void hosted.start({ connectionId: connection().id })}>
                {`Reconnect ${providerDisplayName(connection().provider)}`}
              </Button>
            )}
          </Show>
          <Button variant="secondary" onClick={() => void hosted.start()}>
            Add a different account
          </Button>
        </Inline>
      </Show>
      <HostedBrowserPanel
        connected={hasConnection()}
        controller={hosted}
        renderConnectAction={false}
      />
      <ConnectionList
        connections={page.connections}
        departingId={page.departingId}
        disconnectingId={page.disconnectingId}
        isLoading={page.isLoading}
        loadFailure={page.loadFailure}
        reconnectingId={hosted.startingConnectionId}
        onDisconnect={page.disconnectLinking}
        onReconnect={(connection) => void hosted.start({ connectionId: connection.id })}
        onRefresh={page.refresh}
      />
      <ActionFeedback feedback={page.feedback()} />
    </Stack>
  );
}

type ConnectionsSectionProps = {
  readonly connectionsQuery: Accessor<ConnectionListQueryOptions>;
  readonly remote: ConnectionRemote;
  readonly onRefresh: () => Promise<void>;
  readonly connect?: string;
  readonly connection?: string;
};
