import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import {
  connectionQueries,
  refreshConnectionLists,
} from "#browser/connections/connectionQueries.ts";
import { connectionRemote } from "#browser/connections/connectionRemote.ts";
import { parseConnectionSearch } from "#browser/connections/connectionSearch.ts";
import { ConnectionsSection } from "#browser/connections/ConnectionsSection.tsx";
import { requireAuthenticatedSession } from "#browser/session/requireAuthenticatedSession.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";
import { Page } from "#browser/shared-ui/Page.tsx";
import { teamQueries } from "#browser/teams/teamQueries.ts";

export const Route = createFileRoute("/connections")({
  ssr: true,
  validateSearch: parseConnectionSearch,
  context: () => ({
    connectionsQuery: connectionQueries.list(connectionRemote),
  }),
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
  const search = Route.useSearch();
  return (
    <AppShell>
      <Page
        title="Connect an account"
        lede="Sign in to a league site in a private browser. Lineupgrade keeps the encrypted session, not your password."
      >
        <ConnectionsSection
          connect={search().connect}
          connection={search().connection}
          connectionsQuery={() => context().connectionsQuery}
          onRefresh={() =>
            refreshConnectionLists(context().queryClient).then(() =>
              context().queryClient.invalidateQueries({ queryKey: teamQueries.all() }),
            )
          }
          remote={connectionRemote}
        />
      </Page>
    </AppShell>
  );
}
