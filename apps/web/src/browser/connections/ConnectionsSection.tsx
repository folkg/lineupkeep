import { EffectArray, EffectOption } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Accessor } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { ButtonLink } from "#browser/shared-ui/ButtonLink.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { ConnectionView } from "#contracts/connections/connectionContract.ts";
import {
  defaultProviderKey,
  defaultProviderName,
  providerDisplayName,
} from "#contracts/connections/providerLabels.ts";

import { ConnectionList } from "./ConnectionList";
import type { ConnectionListQueryOptions } from "./connectionQueries";
import type { ConnectionRemote } from "./connectionRemote";
import { GoogleSignInNote } from "./GoogleSignInNote";
import { useConnectionsPage } from "./useConnectionsPage";

export function ConnectionsSection(props: ConnectionsSectionProps): JSX.Element {
  const page = useConnectionsPage({
    connectionsQuery: () => props.connectionsQuery(),
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

  return (
    <Stack as="section" gap="md" labelledBy="connections-title">
      <SectionTitle id="connections-title">Connections</SectionTitle>
      <Text type="meta" tone="muted">
        Lineupgrade keeps the encrypted sign-in session, not your password.
      </Text>
      <GoogleSignInNote />
      <Show when={!hasConnection()}>
        <Inline gap="sm">
          <ButtonLink to="/connections" search={{ connect: defaultProviderKey }}>
            {`Connect ${defaultProviderName()}`}
          </ButtonLink>
        </Inline>
      </Show>
      <Show when={hasConnection()}>
        <Inline gap="sm">
          <Show when={reconnectable()}>
            {(connection) => (
              <ButtonLink
                to="/connections"
                search={{ connect: connection().provider, connection: connection().id }}
              >
                {`Reconnect ${providerDisplayName(connection().provider)}`}
              </ButtonLink>
            )}
          </Show>
          <ButtonLink
            to="/connections"
            search={{ connect: defaultProviderKey }}
            variant="secondary"
          >
            Add a different account
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
