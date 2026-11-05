import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Accessor } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";

import { ConnectionList } from "./ConnectionList";
import type { ConnectionListQueryOptions } from "./connectionQueries";
import type { ConnectionRemote } from "./connectionRemote";
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

  return (
    <Stack as="section" gap="md" labelledBy="connections-title">
      <SectionTitle
        action={
          <Show when={hasConnection() && hosted.session() === undefined}>
            <Button variant="secondary" onClick={() => void hosted.start()}>
              Connect another account
            </Button>
          </Show>
        }
        id="connections-title"
      >
        Connections
      </SectionTitle>
      <Text size="caption" tone="muted">
        Lineupgrade keeps the encrypted sign-in session, not your password.
      </Text>
      <HostedBrowserPanel
        connected={hasConnection()}
        controller={hosted}
        renderConnectAction={false}
      />
      <ConnectionList
        connections={page.connections}
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
};
