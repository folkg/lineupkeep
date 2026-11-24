import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import { useSessionActions } from "#browser/app-shell/useSessionActions.ts";
import { LandingPage } from "#browser/landing/LandingPage.tsx";
import { sessionQueries } from "#browser/session/sessionQueries.ts";
import { teamQueries } from "#browser/teams/teamQueries.ts";
import { teamRemote } from "#browser/teams/teamRemote.ts";
import { useTeamsWarmup } from "#browser/teams/useTeamsWarmup.ts";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(
      sessionQueries.current(context.sessionRemote),
    );
    if (session.status !== "authenticated") {
      return;
    }
    void context.queryClient.prefetchQuery(teamQueries.list(teamRemote));
    void context.queryClient.prefetchQuery(teamQueries.cards(teamRemote));
  },
  component: LandingRoute,
});

function LandingRoute(): JSX.Element {
  const session = useSessionActions();
  useTeamsWarmup(session.isSignedIn);
  return <LandingPage />;
}
