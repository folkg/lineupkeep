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
import type { TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { teamQueries } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";
import { TeamsPage } from "./TeamsPage";

const baseTeam: TeamSummaryView = {
  team: {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1",
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
      status: "disabled",
      changedAt: "2026-10-25T08:00:00.000Z",
    },
    lastSeenAt: "2026-10-25T08:00:00.000Z",
    createdAt: "2026-10-25T08:00:00.000Z",
    updatedAt: "2026-10-25T08:00:00.000Z",
  },
  connectionStatus: "ready",
  recentRuns: [],
};

it("enables a disabled team and shows the confirmed state", async () => {
  const changes: Array<{ readonly team: string; readonly enabled: boolean }> = [];
  using _app = setupTeamsPage([baseTeam], {
    setEnabled: (input) => {
      changes.push(input);
      const enabled = {
        ...baseTeam,
        team: {
          ...baseTeam.team,
          automation: { changedAt: baseTeam.team.automation.changedAt, status: "enabled" as const },
        },
      };
      return Promise.resolve({ changed: [enabled], teams: [enabled] });
    },
  });

  await expect.element(page.getByText("Automation off")).toBeVisible();
  await page.getByRole("button", { name: "Enable automation" }).click();

  await expect.element(page.getByText("Automation on")).toBeVisible();
  expect(changes).toEqual([{ team: baseTeam.team.id, enabled: true }]);
});

it("labels a pause as the rest of the fantasy day and offers resume", async () => {
  using _app = setupTeamsPage([
    {
      ...baseTeam,
      team: {
        ...baseTeam.team,
        automation: {
          status: "paused-until-fantasy-day-end",
          changedAt: "2026-10-25T08:00:00.000Z",
          pausedAt: "2026-10-25T08:00:00.000Z",
          resumesAt: "2026-10-26T07:00:00.000Z",
          timeZone: "America/Los_Angeles",
          fantasyDay: "2026-10-25",
          policyVersion: "yahoo-pacific-midnight/1",
        },
      },
    },
  ]);

  await expect.element(page.getByText("Paused for the rest of this fantasy day")).toBeVisible();
  await expect.element(page.getByText(/Resumes .*America\/Los_Angeles/)).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Resume automation" })).toBeVisible();
});

it("shows a reconnect action without flattening it into disabled", async () => {
  using _app = setupTeamsPage([
    {
      ...baseTeam,
      connectionStatus: "reconnect-required",
      team: {
        ...baseTeam.team,
        automation: { status: "enabled", changedAt: "2026-10-25T08:00:00.000Z" },
      },
    },
  ]);

  await expect.element(page.getByRole("link", { name: "Reconnect Yahoo" })).toBeVisible();
  await expect.element(page.getByText("Automation on")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Enable automation" }))
    .not.toBeInTheDocument();
});

it("shows an empty state before any teams are discovered", async () => {
  using _empty = setupTeamsPage([]);
  await expect.element(page.getByText("No teams yet.")).toBeVisible();
});

it("shows a recoverable failure instead of an empty team list", async () => {
  using _app = setupTeamsPage([], { list: () => Promise.reject(new Error("Network")) });
  await expect.element(page.getByText("We could not load your teams.")).toBeVisible();
});

it("shows a loading state while the team list is pending", async () => {
  const pending = Promise.withResolvers<ReadonlyArray<TeamSummaryView>>();
  using _app = setupTeamsPage([], { list: () => pending.promise });
  await expect.element(page.getByText("Loading your teams…")).toBeVisible();
  pending.resolve([]);
  await expect.element(page.getByText("No teams yet.")).toBeVisible();
});

function setupTeamsPage(
  teams: ReadonlyArray<TeamSummaryView>,
  overrides: Partial<Pick<TeamRemote, "list" | "setEnabled" | "pause">> = {},
): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const remote: TeamRemote = {
    list: overrides.list ?? (() => Promise.resolve(teams)),
    setEnabled: overrides.setEnabled ?? (() => Promise.resolve({ changed: [], teams })),
    pause: overrides.pause ?? (() => Promise.resolve({ changed: [], teams })),
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
  const teamsListRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/teams",
    component: () => (
      <TeamsPage
        teamsQuery={() => teamsQuery}
        remote={remote}
        onRefresh={() => Promise.resolve()}
      />
    ),
  });
  const teamRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/teams/$teamId",
    component: () => <p>Team</p>,
  });
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/runs/$runId",
    component: () => <p>Run</p>,
  });
  const router = createRouter({
    context: { queryClient, sessionRemote },
    history: createMemoryHistory({ initialEntries: ["/teams"] }),
    routeTree: rootRoute.addChildren([teamsListRoute, teamRoute, runRoute]),
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
