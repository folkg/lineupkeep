import type { JSX } from "@solidjs/web";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextField } from "#browser/shared-ui/TextField.tsx";

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
        lede="Connect Yahoo once in a private browser session, or use the local helper on your computer. Lineupkeep never stores your provider password."
        title="Connections"
      >
        <Stack gap="lg">
          <HostedBrowserPanel controller={hosted} />
          <ConnectionList
            approvingId={page.approvingId}
            cancelingId={page.cancelingId}
            connections={page.connections}
            disconnectingId={page.disconnectingId}
            reconnectingId={page.reconnectingId}
            reconnectCode={page.reconnectCode}
            isLoading={page.isLoading}
            loadFailure={page.loadFailure}
            onApprove={page.approveLinking}
            onCancel={page.cancelLinking}
            onDisconnect={page.disconnectLinking}
            onReconnect={page.reconnectLinking}
            onChangeReconnectCode={page.changeReconnectCode}
            onRefresh={page.refresh}
          />
          <Stack as="section" gap="sm" labelledBy="link-provider-title">
            <Heading id="link-provider-title" level={2} size="section">
              Fallback: pair the local helper
            </Heading>
            <Text size="body" tone="muted">
              If the hosted sign-in is unavailable, run the Lineupkeep helper on your computer and
              enter the pairing code it shows. The request expires after ten minutes, and the helper
              signs in to the provider itself.
            </Text>
            <Form gap="sm" onSubmit={page.startLinking}>
              <TextField
                autocomplete="off"
                autocapitalize="characters"
                label="Pairing code"
                spellcheck={false}
                value={page.pairingCode()}
                onInput={(event) => page.changePairingCode(event.currentTarget.value)}
              />
              <Button pending={page.isStarting()} pendingLabel="Pairing…" type="submit">
                Pair helper
              </Button>
            </Form>
            <ActionFeedback feedback={page.feedback()} />
          </Stack>
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
