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
import { formatDateTime, formatDay, formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import type { LineupRunView, TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { TeamDetailPage } from "./TeamDetailPage";
import { teamQueries } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";

const teamId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1";
const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1_000).toISOString();

const noOpSummary = "The lineup already matched the explicit plan; no provider write was needed.";

const noOpRun: LineupRunView = {
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
    summary: noOpSummary,
    observedAt: threeDaysAgo,
    changes: [],
    lockedPlayers: 0,
    editablePlayers: 8,
  },
};

const changedRun: LineupRunView = {
  ...noOpRun,
  run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b3",
  status: "completed",
  outcome: {
    kind: "changed",
    verified: true,
    reconciled: false,
    summary: "Verified 2 native lineup changes.",
    observedAt: threeDaysAgo,
    changes: [
      { name: "Sam Rivers", from: "BN", to: "WR" },
      { name: "Alex Vance", from: "BN", to: "RB" },
    ],
    lockedPlayers: 0,
    editablePlayers: 8,
  },
};

const failedRun: LineupRunView = {
  ...noOpRun,
  run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b4",
  status: "failed",
  outcome: {
    kind: "failed",
    verified: false,
    reconciled: false,
    summary: "The provider rejected the lineup.",
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
  lastRun: noOpRun,
  recentRuns: [noOpRun],
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

it("names the league context and keeps quiet states off the page", async () => {
  using _app = setupTeamDetailPage(team);

  await expect.element(page.getByText("Football · NFL 2026")).toBeVisible();
  await expect.element(page.getByText("Connected")).not.toBeInTheDocument();
  await expect.element(page.getByText("Available")).not.toBeInTheDocument();
  await expect.element(page.getByText(/lists this team/)).not.toBeInTheDocument();
  await expect
    .element(page.getByText("Lineup settings and recent activity for this team."))
    .not.toBeInTheDocument();
});

it("names the pause in reader-local time", async () => {
  const paused: TeamSummaryView = {
    ...team,
    team: {
      ...team.team,
      automation: {
        status: "paused-until-fantasy-day-end",
        changedAt: threeDaysAgo,
        pausedAt: threeDaysAgo,
        resumesAt: "2026-10-26T07:00:00.000Z",
        timeZone: "America/Los_Angeles",
        fantasyDay: "2026-10-25",
        fantasyDayVersion: "yahoo-pacific-midnight/1",
      },
    },
  };
  using _app = setupTeamDetailPage(paused);

  await expect
    .element(
      page.getByText(
        `Paused for the rest of the fantasy day. Resumes after ${formatDateTime(
          "2026-10-26T07:00:00.000Z",
        )}.`,
      ),
    )
    .toBeVisible();
});

it("folds consecutive checks that changed nothing and keeps the rest on their own", async () => {
  const runs = [
    changedRun,
    { ...noOpRun, run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c1" },
    { ...noOpRun, run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c2" },
    { ...noOpRun, run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c3" },
    failedRun,
  ];
  using _app = setupTeamDetailPage({ ...team, lastRun: changedRun, recentRuns: runs });

  const groupLabel = `3 checks on ${formatDay(noOpRun.updatedAt)} changed nothing`;
  await expect.element(page.getByText(groupLabel)).toBeVisible();
  await expect.element(page.getByText("Verified 2 native lineup changes.")).toBeVisible();
  await expect.element(page.getByText("The provider rejected the lineup.")).toBeVisible();
  await expect.element(page.getByText(noOpSummary).first()).not.toBeVisible();

  await page.getByText(groupLabel).click();

  await expect.element(page.getByText(noOpSummary).first()).toBeVisible();
  await expect.element(page.getByRole("link", { name: "View run detail" }).first()).toBeVisible();
});

it("leaves a lone quiet check on its own line", async () => {
  using _app = setupTeamDetailPage({ ...team, lastRun: noOpRun, recentRuns: [noOpRun] });

  await expect.element(page.getByText(noOpSummary)).toBeVisible();
  await expect.element(page.getByText(/changed nothing$/u)).not.toBeInTheDocument();
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
