import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Accessor } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { ButtonLink } from "#browser/shared-ui/ButtonLink.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { defaultProviderKey, defaultProviderName } from "#contracts/connections/providerLabels.ts";

import { ConnectionList } from "./ConnectionList";
import type { ConnectionListQueryOptions } from "./connectionQueries";
import type { ConnectionRemote } from "./connectionRemote";
import { useConnectionsPage } from "./useConnectionsPage";

export function ConnectionsSection(props: ConnectionsSectionProps): JSX.Element {
  const page = useConnectionsPage({
    connectionsQuery: () => props.connectionsQuery(),
    remote: () => props.remote,
    onRefresh: () => props.onRefresh(),
  });
  const hasConnection = (): boolean => page.connections().length > 0;

  return (
    <Stack as="section" gap="md" labelledBy="connections-title">
      <SectionTitle id="connections-title">Connections</SectionTitle>
      <Text type="meta" tone="muted">
        Lineupgrade stores the encrypted sign-in session, not your password.
      </Text>
      <Show when={!hasConnection()}>
        <Inline gap="sm">
          <ButtonLink to="/connections" search={{ connect: defaultProviderKey }}>
            {`Connect ${defaultProviderName()}`}
          </ButtonLink>
        </Inline>
      </Show>
      <Show when={hasConnection()}>
        <Inline gap="sm">
          <ButtonLink
            to="/connections"
            search={{ connect: defaultProviderKey }}
            variant="secondary"
          >
            Connect another account
          </ButtonLink>
        </Inline>
      </Show>
      <ConnectionList
        connections={page.connections}
        departingId={page.departingId}
        disconnectingId={page.disconnectingId}
        isLoading={page.isLoading}
        loadFailure={page.loadFailure}
        onDisconnect={page.disconnectLinking}
        onReconnect={page.openSignIn}
        onRefresh={page.refresh}
      />
      <ActionFeedback feedback={page.feedback()} />
    </Stack>
  );
}

type ConnectionsSectionProps = {
  readonly connectionsQuery: Accessor<ConnectionListQueryOptions>;
  readonly onRefresh: () => Promise<void>;
  readonly remote: ConnectionRemote;
};
