import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import { AccountPage } from "#browser/account/AccountPage.tsx";
import { accountRemote } from "#browser/account/accountRemote.ts";
import {
  connectionQueries,
  refreshConnectionLists,
} from "#browser/connections/connectionQueries.ts";
import { connectionRemote } from "#browser/connections/connectionRemote.ts";
import { ConnectionsSection } from "#browser/connections/ConnectionsSection.tsx";
import { requireAuthenticatedSession } from "#browser/session/requireAuthenticatedSession.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";
import {
  refreshSignInSessions,
  signInSessionsQueries,
} from "#browser/session/signInSessionsQueries.ts";
import { signInSessionsRemote } from "#browser/session/signInSessionsRemote.ts";

export const Route = createFileRoute("/account")({
  ssr: true,
  context: () => ({
    connectionsQuery: connectionQueries.list(connectionRemote),
    signInSessionsQuery: signInSessionsQueries.list(signInSessionsRemote),
  }),
  beforeLoad: ({ context, location }) =>
    requireAuthenticatedSession(
      () => context.queryClient.ensureQueryData(sessionQueries.current(context.sessionRemote)),
      location.href,
    ).then(() => undefined),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(context.connectionsQuery),
      context.queryClient.ensureQueryData(context.signInSessionsQuery),
    ]),
  component: AccountRoute,
});

function AccountRoute(): JSX.Element {
  const context = Route.useRouteContext();
  return (
    <AccountPage
      connections={
        <ConnectionsSection
          connectionsQuery={() => context().connectionsQuery}
          onRefresh={() => refreshConnectionLists(context().queryClient)}
          remote={connectionRemote}
        />
      }
      onErased={() => context().queryClient.resetQueries()}
      onRefreshSessions={() => refreshSignInSessions(context().queryClient)}
      remote={accountRemote}
      sessionsQuery={() => context().signInSessionsQuery}
      sessionsRemote={signInSessionsRemote}
    />
  );
}
