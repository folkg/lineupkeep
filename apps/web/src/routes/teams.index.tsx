import { isServer } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import { requireAuthenticatedSession } from "#browser/session/requireAuthenticatedSession.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";
import { refreshTeamLists, teamQueries } from "#browser/teams/teamQueries.ts";
import { teamRemote } from "#browser/teams/teamRemote.ts";
import { TeamsPage } from "#browser/teams/TeamsPage.tsx";

export const Route = createFileRoute("/teams/")({
  ssr: true,
  context: () => ({ teamsQuery: teamQueries.list(teamRemote) }),
  beforeLoad: async ({ context, location }) => {
    const session = await requireAuthenticatedSession(
      () => context.queryClient.ensureQueryData(sessionQueries.current(context.sessionRemote)),
      location.href,
    );
    return { viewerId: session.userId };
  },
  loader: ({ context }) => {
    if (isServer || context.queryClient.isMutating() > 0) {
      return context.queryClient.ensureQueryData(context.teamsQuery);
    }
    void context.queryClient.prefetchQuery(context.teamsQuery);
  },
  component: TeamsRoute,
});

function TeamsRoute(): JSX.Element {
  const context = Route.useRouteContext();
  return (
    <TeamsPage
      teamsQuery={() => context().teamsQuery}
      viewerId={context().viewerId}
      remote={teamRemote}
      onRefresh={() => refreshTeamLists(context().queryClient)}
    />
  );
}
