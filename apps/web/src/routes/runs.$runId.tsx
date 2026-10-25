import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import { requireAuthenticatedSession } from "#browser/session/requireAuthenticatedSession.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";
import { RunDetailPage } from "#browser/teams/RunDetailPage.tsx";
import { refreshTeamLists, teamQueries } from "#browser/teams/teamQueries.ts";
import { teamRemote } from "#browser/teams/teamRemote.ts";

export const Route = createFileRoute("/runs/$runId")({
  ssr: true,
  beforeLoad: ({ context, location }) =>
    requireAuthenticatedSession(
      () => context.queryClient.ensureQueryData(sessionQueries.current(context.sessionRemote)),
      location.href,
    ).then(() => undefined),
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(teamQueries.list(teamRemote)),
      context.queryClient.ensureQueryData(teamQueries.run(teamRemote, params.runId)),
    ]),
  component: RunDetailRoute,
});

function RunDetailRoute(): JSX.Element {
  const context = Route.useRouteContext();
  const params = Route.useParams();
  return (
    <RunDetailPage
      runId={params().runId}
      runQuery={() => teamQueries.run(teamRemote, params().runId)}
      teamsQuery={() => teamQueries.list(teamRemote)}
      remote={teamRemote}
      onRefresh={() => refreshTeamLists(context().queryClient)}
    />
  );
}
