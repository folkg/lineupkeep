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
  beforeLoad: ({ context, location }) =>
    requireAuthenticatedSession(
      () => context.queryClient.ensureQueryData(sessionQueries.current(context.sessionRemote)),
      location.href,
    ).then(() => undefined),
  loader: ({ context }) => context.queryClient.ensureQueryData(context.teamsQuery),
  component: TeamsRoute,
});

function TeamsRoute(): JSX.Element {
  const context = Route.useRouteContext();
  return (
    <TeamsPage
      teamsQuery={() => context().teamsQuery}
      remote={teamRemote}
      onRefresh={() => refreshTeamLists(context().queryClient)}
    />
  );
}
