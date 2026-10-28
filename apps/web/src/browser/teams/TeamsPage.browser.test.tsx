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

import { requireTeamSuccess } from "./teamFailure";
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

const enabledTeam: TeamSummaryView = {
  ...baseTeam,
  team: {
    ...baseTeam.team,
    automation: { changedAt: baseTeam.team.automation.changedAt, status: "enabled" },
  },
};

const pausedTeam: TeamSummaryView = {
  ...enabledTeam,
  team: {
    ...enabledTeam.team,
    automation: {
      status: "paused-until-fantasy-day-end",
      changedAt: "2026-10-25T08:00:00.000Z",
      pausedAt: "2026-10-25T08:00:00.000Z",
      resumesAt: "2026-10-26T07:00:00.000Z",
      timeZone: "America/Los_Angeles",
      fantasyDay: "2026-10-25",
      fantasyDayVersion: "yahoo-pacific-midnight/1",
    },
  },
};

it("enables a disabled team and shows the confirmed state", async () => {
  const changes: Array<{ readonly team: string; readonly action: string }> = [];
  using _app = setupTeamsPage([baseTeam], {
    control: (input) => {
      changes.push(input);
      const enabled = enabledTeam;
      return Promise.resolve({ changed: [enabled], teams: [enabled] });
    },
  });

  await expect.element(page.getByText("Lineup checks off")).toBeVisible();
  await page.getByRole("button", { name: "Turn on lineup checks" }).click();

  await expect.element(page.getByText("Lineup checks on")).toBeVisible();
  expect(changes).toEqual([{ team: baseTeam.team.id, action: "enable" }]);
});

it("labels a pause as the rest of the fantasy day and resumes through the control action", async () => {
  const changes: Array<{ readonly team: string; readonly action: string }> = [];
  using _app = setupTeamsPage([pausedTeam], {
    control: (input) => {
      changes.push(input);
      return Promise.resolve({ changed: [enabledTeam], teams: [enabledTeam] });
    },
  });

  await expect.element(page.getByText("Paused until the end of the fantasy day")).toBeVisible();
  await expect
    .element(page.getByText(/Lineup checks resume at .*America\/Los_Angeles/))
    .toBeVisible();
  await page.getByRole("button", { name: "Resume lineup checks" }).click();

  await expect.element(page.getByText("Lineup checks on")).toBeVisible();
  expect(changes).toEqual([{ team: pausedTeam.team.id, action: "resume" }]);
});

it("pauses an enabled team for the rest of the fantasy day", async () => {
  const changes: Array<{ readonly team: string; readonly action: string }> = [];
  using _app = setupTeamsPage([enabledTeam], {
    control: (input) => {
      changes.push(input);
      return Promise.resolve({ changed: [pausedTeam], teams: [pausedTeam] });
    },
  });

  await page.getByRole("button", { name: "Pause for the rest of the fantasy day" }).click();

  await expect.element(page.getByText("Paused until the end of the fantasy day")).toBeVisible();
  expect(changes).toEqual([{ team: enabledTeam.team.id, action: "pause-today" }]);
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
  await expect.element(page.getByText("Lineup checks on")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Turn on lineup checks" }))
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

it("imports provider teams when the owner refreshes discovery", async () => {
  const discovered = {
    ...baseTeam,
    team: { ...baseTeam.team, id: crypto.randomUUID(), name: "Beta" },
  };
  using _empty = setupTeamsPage([], {
    refresh: () => Promise.resolve({ teams: [discovered] }),
  });

  await expect.element(page.getByText("No teams yet.")).toBeVisible();
  await page.getByRole("button", { name: "Refresh teams" }).click();

  await expect.element(page.getByRole("link", { name: "Beta", exact: true })).toBeVisible();
  await expect.element(page.getByText("Teams refreshed from Yahoo.")).toBeVisible();
});

it("keeps the list and reports a failed refresh", async () => {
  using _app = setupTeamsPage([baseTeam], {
    refresh: () =>
      Promise.resolve(
        requireTeamSuccess({ type: "error", error: { type: "team.refresh_failed" } }),
      ),
  });

  await page.getByRole("button", { name: "Refresh teams" }).click();

  await expect
    .element(page.getByText("We could not refresh teams from Yahoo. Try again."))
    .toBeVisible();
  await expect.element(page.getByRole("link", { name: "Alpha", exact: true })).toBeVisible();
});

function setupTeamsPage(
  teams: ReadonlyArray<TeamSummaryView>,
  overrides: Partial<Pick<TeamRemote, "list" | "refresh" | "control">> = {},
): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const remote: TeamRemote = {
    list: overrides.list ?? (() => Promise.resolve(teams)),
    refresh: overrides.refresh ?? (() => Promise.resolve({ teams })),
    control: overrides.control ?? (() => Promise.resolve({ changed: [], teams })),
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
