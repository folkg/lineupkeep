import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import { requireAuthenticatedSession } from "#browser/session/requireAuthenticatedSession.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";
import { refreshTeamLists, teamQueries } from "#browser/teams/teamQueries.ts";
import { teamRemote } from "#browser/teams/teamRemote.ts";
import { TeamsPage } from "#browser/teams/TeamsPage.tsx";

export const Route = createFileRoute("/teams/")({
  ssr: true,
  context: () => ({
    teamsQuery: teamQueries.list(teamRemote),
    cardsQuery: teamQueries.cards(teamRemote),
  }),
  beforeLoad: async ({ context, location }) => {
    await requireAuthenticatedSession(
      () => context.queryClient.ensureQueryData(sessionQueries.current(context.sessionRemote)),
      location.href,
    );
  },
  loader: ({ context }) => {
    if (typeof window === "undefined" || context.queryClient.isMutating() > 0) {
      return Promise.all([
        context.queryClient.ensureQueryData(context.teamsQuery),
        context.queryClient.ensureQueryData(context.cardsQuery),
      ]);
    }
    void context.queryClient.prefetchQuery(context.teamsQuery);
    void context.queryClient.prefetchQuery(context.cardsQuery);
  },
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
