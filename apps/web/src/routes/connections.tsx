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

export const Route = createFileRoute("/connections")({
  ssr: true,
  context: () => ({ connectionsQuery: connectionQueries.list(connectionRemote) }),
  beforeLoad: ({ context, location }) =>
    requireAuthenticatedSession(
      () => context.queryClient.ensureQueryData(sessionQueries.current(context.sessionRemote)),
      location.href,
    ).then(() => undefined),
  loader: ({ context }) => context.queryClient.ensureQueryData(context.connectionsQuery),
  component: ConnectionsRoute,
});

function ConnectionsRoute(): JSX.Element {
  const context = Route.useRouteContext();

  return (
    <ConnectionsPage
      connectionsQuery={() => context().connectionsQuery}
      remote={connectionRemote}
      onRefresh={() => refreshConnectionLists(context().queryClient)}
    />
  );
}
