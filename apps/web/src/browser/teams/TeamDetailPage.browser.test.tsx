import { render } from "@solidjs/web";
import { QueryClientProvider } from "@tanstack/solid-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/solid-router";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import type { RouterContext } from "#browser/app-shell/routerContext.ts";
import { createQueryClient } from "#browser/query/queryClient.ts";
import type { SessionRemote } from "#browser/session/sessionRemote.ts";
import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import type { LineupRunView, TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { TeamDetailPage } from "./TeamDetailPage";
import { teamQueries } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";

const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1_000).toISOString();
const teamId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1";

const recentRun: LineupRunView = {
  run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b1",
  request: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b2",
  team: teamId,
  target: { coverage: "current" },
  trigger: "scheduled",
  implementation: "provider_native",
  implementationVersion: "1",
  status: "skipped",
  attempts: 1,
  createdAt: threeDaysAgo,
  updatedAt: threeDaysAgo,
  outcome: {
    kind: "no_op",
    verified: true,
    reconciled: false,
    summary: "No changes were needed.",
    observedAt: threeDaysAgo,
    changes: [],
    lockedPlayers: 0,
    editablePlayers: 8,
  },
};

const team: TeamSummaryView = {
  team: {
    id: teamId,
    connectionId: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a2",
    provider: "yahoo",
    providerTeamKey: "461.l.1000.t.1",
    providerLeagueKey: "461.l.1000",
    league: "nfl",
    sport: "football",
    season: 2026,
    name: "Alpha",
    availability: "available",
    automation: {
      status: "enabled",
      changedAt: threeDaysAgo,
    },
    lastSeenAt: threeDaysAgo,
    createdAt: threeDaysAgo,
    updatedAt: threeDaysAgo,
  },
  connectionStatus: "ready",
  lastRun: recentRun,
  recentRuns: [recentRun],
};

it("offers a way back to the teams list and shows the run time in the reader's zone", async () => {
  using _app = setupTeamDetailPage(team);

  await expect
    .element(page.getByRole("link", { name: "Back to teams" }))
    .toHaveAttribute("href", "/teams");
  const time = document.querySelector<HTMLTimeElement>(`time[datetime="${threeDaysAgo}"]`);
  expect(time?.textContent).toBe(formatReaderTime(threeDaysAgo));
  await expect.element(page.getByText(formatReaderTime(threeDaysAgo))).toBeVisible();
});

it("links a team report to the feedback form with the team reference", async () => {
  using _app = setupTeamDetailPage(team);

  const report = page.getByRole("link", { name: "Report a problem with this team" });
  await expect.element(report).toBeVisible();
  const href = report.element().getAttribute("href");
  const url = new URL(href ?? "", window.location.origin);

  expect(url.pathname).toBe("/feedback");
  expect(url.searchParams.get("surface")).toBe("team");
  expect(url.searchParams.get("team")).toBe(teamId);
});

it("shows no local helper affordances", async () => {
  using _app = setupTeamDetailPage(team);

  await expect.element(page.getByText("Use the local helper instead")).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("button", { name: "Approve helper" }))
    .not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Pair helper" })).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("button", { name: "Start reconnect" }))
    .not.toBeInTheDocument();
});

function setupTeamDetailPage(teamSummary: TeamSummaryView): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const remote: TeamRemote = {
    list: () => Promise.resolve([teamSummary]),
    refresh: () => Promise.resolve({ teams: [teamSummary] }),
    control: () => Promise.resolve({ changed: [], teams: [teamSummary] }),
    readRun: () => Promise.reject(new Error("Unexpected run read")),
  };
  const teamsQuery = teamQueries.list(remote);
  const sessionRemote: SessionRemote = {
    load: () => Promise.resolve({ status: "anonymous" }),
    signOut: () => Promise.resolve(),
  };
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const teamsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/teams",
    component: () => <p>Teams</p>,
  });
  const teamRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/teams/$teamId",
    component: () => (
      <TeamDetailPage
        teamId={teamSummary.team.id}
        teamsQuery={() => teamsQuery}
        remote={remote}
        onRefresh={() => Promise.resolve()}
      />
    ),
  });
  const feedbackRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feedback",
    component: () => <p>Feedback</p>,
  });
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/runs/$runId",
    component: () => <p>Run</p>,
  });
  const router = createRouter({
    context: { queryClient, sessionRemote },
    history: createMemoryHistory({ initialEntries: [`/teams/${teamSummary.team.id}`] }),
    routeTree: rootRoute.addChildren([teamsRoute, teamRoute, feedbackRoute, runRoute]),
  });
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => <RouterProvider router={router} />, host);

  return {
    [Symbol.dispose](): void {
      dispose();
      queryClient.clear();
      host.remove();
    },
  };
}
