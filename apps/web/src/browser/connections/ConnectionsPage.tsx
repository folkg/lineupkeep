import type { JSX } from "@solidjs/web";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextField } from "#browser/shared-ui/TextField.tsx";
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
          <Stack as="section" align="start" gap="sm" label="Local helper">
            <Button
              aria-controls="local-helper"
              aria-expanded={page.helperOpen() ? "true" : "false"}
              variant="link"
              onClick={page.toggleHelper}
            >
              Having trouble? Use the local helper
            </Button>
            <Stack id="local-helper" hidden={!page.helperOpen()} gap="sm">
              <Heading id="local-helper-title" level={2} size="section">
                Pair the local helper
              </Heading>
              <Text size="body" tone="muted">
                Run the Lineupkeep helper on your computer and enter the code it shows. The code
                expires after ten minutes; the helper signs in to {defaultProviderName()} itself.
              </Text>
              <Form gap="sm" onSubmit={page.startLinking}>
                <Stack gap="sm" measure="control">
                  <TextField
                    autocomplete="off"
                    autocapitalize="characters"
                    label="Pairing code"
                    spellcheck={false}
                    value={page.pairingCode()}
                    onInput={(event) => page.changePairingCode(event.currentTarget.value)}
                  />
                </Stack>
                <Inline gap="sm">
                  <Button pending={page.isStarting()} pendingLabel="Pairing…" type="submit">
                    Pair helper
                  </Button>
                </Inline>
              </Form>
              <ActionFeedback feedback={page.feedback()} />
            </Stack>
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
