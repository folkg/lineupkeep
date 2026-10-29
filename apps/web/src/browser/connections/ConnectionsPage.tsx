import type { JSX } from "@solidjs/web";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { defaultProviderName } from "#contracts/connections/providerLabels.ts";

import { ConnectionList } from "./ConnectionList";
import type { ConnectionListQueryOptions } from "./connectionQueries";
import type { ConnectionRemote } from "./connectionRemote";
import { HostedBrowserPanel } from "./HostedBrowserPanel";
import { useConnectionsPage } from "./useConnectionsPage";
import { useHostedLinking } from "./useHostedLinking";

export function ConnectionsPage(props: ConnectionsPageProps): JSX.Element {
  const page = useConnectionsPage({
    connectionsQuery: () => props.connectionsQuery(),
    remote: () => props.remote,
    onRefresh: () => props.onRefresh(),
  });
  const hosted = useHostedLinking({
    remote: () => props.remote,
    onRefresh: () => props.onRefresh(),
  });
  return (
    <AppShell>
      <Page
        lede={`Connect ${defaultProviderName()} once. Lineupkeep keeps the encrypted session, not your password, and finds the teams this account can manage.`}
        title="Connections"
      >
        <Stack gap="xl">
          <HostedBrowserPanel controller={hosted} />
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
      </Page>
    </AppShell>
  );
}

type ConnectionsPageProps = {
  readonly connectionsQuery: Accessor<ConnectionListQueryOptions>;
  readonly remote: ConnectionRemote;
  readonly onRefresh: () => Promise<void>;
};
