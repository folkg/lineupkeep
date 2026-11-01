import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import {
  connectionQueries,
  refreshConnectionLists,
} from "#browser/connections/connectionQueries.ts";
import { connectionRemote } from "#browser/connections/connectionRemote.ts";
import { ConnectionsPage } from "#browser/connections/ConnectionsPage.tsx";
import { requireAuthenticatedSession } from "#browser/session/requireAuthenticatedSession.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";
import {
  refreshSignInSessions,
  signInSessionsQueries,
} from "#browser/session/signInSessionsQueries.ts";
import { signInSessionsRemote } from "#browser/session/signInSessionsRemote.ts";

export const Route = createFileRoute("/connections")({
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
  component: ConnectionsRoute,
});

function ConnectionsRoute(): JSX.Element {
  const context = Route.useRouteContext();

  return (
    <ConnectionsPage
      connectionsQuery={() => context().connectionsQuery}
      remote={connectionRemote}
      onRefresh={() => refreshConnectionLists(context().queryClient)}
      onRefreshSessions={() => refreshSignInSessions(context().queryClient)}
      sessionsQuery={() => context().signInSessionsQuery}
      sessionsRemote={signInSessionsRemote}
    />
  );
}
