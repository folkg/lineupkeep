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

import { ConnectionList } from "./ConnectionList";
import type { ConnectionListQueryOptions } from "./connectionQueries";
import type { ConnectionRemote } from "./connectionRemote";
import { useConnectionsPage } from "./useConnectionsPage";

export function ConnectionsPage(props: ConnectionsPageProps): JSX.Element {
  const page = useConnectionsPage({
    connectionsQuery: () => props.connectionsQuery(),
    remote: () => props.remote,
    onRefresh: () => props.onRefresh(),
  });

  return (
    <AppShell>
      <Page
        lede="Link Yahoo through the local helper on your computer. Lineupkeep never sees your provider password."
        title="Connections"
      >
        <Stack gap="lg">
          <ConnectionList
            cancelingId={page.cancelingId}
            connections={page.connections}
            isLoading={page.isLoading}
            loadFailure={page.loadFailure}
            onCancel={page.cancelLinking}
            onRefresh={page.refresh}
          />
          <Stack as="section" gap="sm" labelledBy="link-provider-title">
            <Heading id="link-provider-title" level={2} size="section">
              Link a provider
            </Heading>
            <Text size="body" tone="muted">
              Start a link, then finish signing in with the local helper. A link request expires
              after ten minutes.
            </Text>
            <Form gap="sm" onSubmit={page.startLinking}>
              <Button pending={page.isStarting()} pendingLabel="Starting…" type="submit">
                Link Yahoo
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
