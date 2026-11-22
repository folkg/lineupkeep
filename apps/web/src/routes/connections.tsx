import type { JSX } from "@solidjs/web";
import { createFileRoute, redirect } from "@tanstack/solid-router";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { refreshConnectionLists } from "#browser/connections/connectionQueries.ts";
import { connectionRemote } from "#browser/connections/connectionRemote.ts";
import { parseConnectionSearch } from "#browser/connections/connectionSearch.ts";
import { ConnectionSignIn } from "#browser/connections/ConnectionSignIn.tsx";
import { requireAuthenticatedSession } from "#browser/session/requireAuthenticatedSession.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";
import { Page } from "#browser/shared-ui/Page.tsx";
import { teamQueries } from "#browser/teams/teamQueries.ts";
import { providerDisplayName } from "#contracts/connections/providerLabels.ts";

export const Route = createFileRoute("/connections")({
  ssr: true,
  validateSearch: parseConnectionSearch,
  beforeLoad: ({ context, location, search }) => {
    if (search.connect === undefined) {
      throw redirect({ to: "/account" });
    }
    return requireAuthenticatedSession(
      () => context.queryClient.ensureQueryData(sessionQueries.current(context.sessionRemote)),
      location.href,
    ).then(() => undefined);
  },
  component: ConnectionsRoute,
});

function ConnectionsRoute(): JSX.Element {
  const context = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const provider = search().connect;
  if (provider === undefined) {
    throw new Error("A connection provider is required");
  }

  return (
    <AppShell>
      <Page
        title={
          search().connection === undefined
            ? `Connect ${providerDisplayName(provider)}`
            : `Reconnect ${providerDisplayName(provider)}`
        }
        lede="This page is only for this sign-in. The private browser closes when you cancel or finish."
      >
        <ConnectionSignIn
          connectionId={search().connection}
          onBack={() => void navigate({ to: "/account" })}
          onRefresh={() =>
            refreshConnectionLists(context().queryClient).then(() =>
              context().queryClient.invalidateQueries({ queryKey: teamQueries.all() }),
            )
          }
          provider={provider}
          remote={connectionRemote}
        />
      </Page>
    </AppShell>
  );
}
