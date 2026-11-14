import type { JSX } from "@solidjs/web";
import { Outlet, createFileRoute, useRouterState } from "@tanstack/solid-router";
import { Show } from "solid-js";

import { requireAuthenticatedSession } from "#browser/session/requireAuthenticatedSession.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";
import { TeamDetailPage } from "#browser/teams/TeamDetailPage.tsx";
import { refreshTeamLists, teamQueries } from "#browser/teams/teamQueries.ts";
import { teamRemote } from "#browser/teams/teamRemote.ts";

export const Route = createFileRoute("/teams/$teamId")({
  ssr: true,
  context: () => ({ teamsQuery: teamQueries.list(teamRemote) }),
  beforeLoad: ({ context, location }) =>
    requireAuthenticatedSession(
      () => context.queryClient.ensureQueryData(sessionQueries.current(context.sessionRemote)),
      location.href,
    ).then(() => undefined),
  loader: ({ context }) => context.queryClient.ensureQueryData(context.teamsQuery),
  component: TeamDetailRoute,
});

function TeamDetailRoute(): JSX.Element {
  const context = Route.useRouteContext();
  const params = Route.useParams();
  const showsTransactionPlans = useRouterState({
    select: (state) =>
      state.matches.some((match) => match.routeId === "/teams/$teamId/transactions"),
  });
  return (
    <Show
      fallback={
        <TeamDetailPage
          teamId={params().teamId}
          teamsQuery={() => context().teamsQuery}
          remote={teamRemote}
          onRefresh={() => refreshTeamLists(context().queryClient)}
        />
      }
      when={showsTransactionPlans()}
    >
      <Outlet />
    </Show>
  );
}
