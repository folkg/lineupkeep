import type { JSX } from "@solidjs/web";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { SignInSessionList } from "#browser/session/SignInSessionList.tsx";
import type { SignInSessionListQueryOptions } from "#browser/session/signInSessionsQueries.ts";
import type { SignInSessionsRemote } from "#browser/session/signInSessionsRemote.ts";
import { useSignInSessions } from "#browser/session/useSignInSessions.ts";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";

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
  const sessions = useSignInSessions({
    query: () => props.sessionsQuery(),
    remote: () => props.sessionsRemote,
    onRefresh: () => props.onRefreshSessions(),
  });
  const readyConnection = (): boolean =>
    page.connections().some((connection) => connection.status === "ready");
  const hasConnection = (): boolean => page.connections().length > 0;
  return (
    <AppShell>
      <Page
        lede={
          hasConnection()
            ? "Lineupgrade keeps the encrypted sign-in session, not your password, and lists the teams this account can manage."
            : "Connect your fantasy account in a private browser. Lineupgrade keeps the encrypted session, not your password, and finds the teams this account can manage."
        }
        title="Connections"
      >
        <Stack gap="xl">
          <HostedBrowserPanel connected={readyConnection()} controller={hosted} />
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
          <SignInSessionList
            endingId={sessions.endingId}
            endingOthers={sessions.endingOthers}
            feedback={sessions.feedback}
            isLoading={sessions.isLoading}
            loadFailure={sessions.loadFailure}
            sessions={sessions.sessions}
            onEnd={sessions.endSession}
            onEndOthers={sessions.endOtherSessions}
            onRefresh={sessions.refresh}
          />
        </Stack>
      </Page>
    </AppShell>
  );
}

type ConnectionsPageProps = {
  readonly connectionsQuery: Accessor<ConnectionListQueryOptions>;
  readonly remote: ConnectionRemote;
  readonly onRefresh: () => Promise<void>;
  readonly sessionsQuery: Accessor<SignInSessionListQueryOptions>;
  readonly sessionsRemote: SignInSessionsRemote;
  readonly onRefreshSessions: () => Promise<void>;
};
