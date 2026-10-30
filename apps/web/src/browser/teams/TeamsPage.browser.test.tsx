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
import { formatDateTime, formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import type {
  LineupRunView,
  TeamChangeView,
  TeamMutationError,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";

import { requireTeamSuccess } from "./teamFailure";
import { teamQueries } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";
import { TeamsPage } from "./TeamsPage";

const teamId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1";
const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString();

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
  createdAt: twoHoursAgo,
  updatedAt: twoHoursAgo,
  outcome: {
    kind: "no_op",
    verified: true,
    reconciled: false,
    summary: "The lineup already matched the explicit plan; no provider write was needed.",
    observedAt: twoHoursAgo,
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
    observedAt: twoHoursAgo,
    changes: [
      { name: "Sam Rivers", from: "BN", to: "WR" },
      { name: "Alex Vance", from: "BN", to: "RB" },
    ],
    lockedPlayers: 0,
    editablePlayers: 8,
  },
};

const baseTeam: TeamSummaryView = {
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
      status: "disabled",
      changedAt: "2026-10-25T08:00:00.000Z",
    },
    ownerNote: null,
    ownerNoteUpdatedAt: null,
    ownerNoteLimit: 2_000,
    lastSeenAt: "2026-10-25T08:00:00.000Z",
    createdAt: "2026-10-25T08:00:00.000Z",
    updatedAt: "2026-10-25T08:00:00.000Z",
  },
  connectionStatus: "ready",
  lastRun: noOpRun,
  recentRuns: [noOpRun],
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

it("turns lineup checks on through the switch and confirms the change", async () => {
  const changes: Array<{ readonly team: string; readonly action: string }> = [];
  using _app = setupTeamsPage([baseTeam], {
    control: (input) => {
      changes.push(input);
      return Promise.resolve({ changed: [enabledTeam], teams: [enabledTeam] });
    },
  });

  const toggle = page.getByRole("switch", { name: "Lineup checks for Alpha" });
  await expect.element(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();

  await expect.element(toggle).toHaveAttribute("aria-checked", "true");
  await expect.element(toggle).not.toHaveAttribute("aria-busy");
  expect(changes).toEqual([{ team: teamId, action: "enable" }]);
});

it("flips the switch before the server answers and returns to the server state when refused", async () => {
  const answer = Promise.withResolvers<TeamChangeView>();
  using _app = setupTeamsPage([baseTeam], { control: () => answer.promise });

  const toggle = page.getByRole("switch", { name: "Lineup checks for Alpha" });
  await expect.element(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();

  await expect.element(toggle).toHaveAttribute("aria-checked", "true");
  await expect.element(toggle).toHaveAttribute("aria-busy", "true");
  await expect
    .element(page.getByRole("listitem").getByRole("status"))
    .toHaveTextContent("Turning on…");

  answer.reject(new Error("Network"));

  await expect.element(toggle).toHaveAttribute("aria-checked", "false");
  await expect.element(toggle).not.toHaveAttribute("aria-busy");
  await expect
    .element(
      page.getByText(
        "We could not confirm the change, so the control returned to the last known state. Check the latest list before trying again.",
      ),
    )
    .toBeVisible();
});

it("returns the switch to the server state when the server refuses the change", async () => {
  const answer = Promise.withResolvers<TeamChangeView>();
  using _app = setupTeamsPage([baseTeam], { control: () => answer.promise });

  const toggle = page.getByRole("switch", { name: "Lineup checks for Alpha" });
  await toggle.click();
  await expect.element(toggle).toHaveAttribute("aria-checked", "true");

  answer.reject(refusal({ type: "team.control_rejected" }));

  await expect.element(toggle).toHaveAttribute("aria-checked", "false");
  await expect
    .element(
      page.getByText(
        "This team changed while the request was in flight, so the control returned to the last known state. Refresh the latest status before trying again.",
      ),
    )
    .toBeVisible();
});

it("labels a pause as the rest of the fantasy day and resumes through the control action", async () => {
  const changes: Array<{ readonly team: string; readonly action: string }> = [];
  using _app = setupTeamsPage([pausedTeam], {
    control: (input) => {
      changes.push(input);
      return Promise.resolve({ changed: [enabledTeam], teams: [enabledTeam] });
    },
  });

  await expect
    .element(
      page.getByText(
        `Paused for the rest of the fantasy day. Resumes after ${formatDateTime(
          pausedTeam.team.automation.resumesAt ?? "",
        )}.`,
      ),
    )
    .toBeVisible();
  await page.getByRole("button", { name: "Resume lineup checks" }).click();

  await expect
    .element(page.getByRole("switch", { name: "Lineup checks for Alpha" }))
    .toHaveAttribute("aria-checked", "true");
  await expect
    .element(page.getByText(/^Paused for the rest of the fantasy day\./u))
    .not.toBeInTheDocument();
  expect(changes).toEqual([{ team: teamId, action: "resume" }]);
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

  await expect
    .element(
      page.getByText(
        `Paused for the rest of the fantasy day. Resumes after ${formatDateTime(
          pausedTeam.team.automation.resumesAt ?? "",
        )}.`,
      ),
    )
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Resume lineup checks" })).toBeVisible();
  expect(changes).toEqual([{ team: teamId, action: "pause-today" }]);
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
  await expect
    .element(page.getByText("Yahoo needs a new sign-in before lineup checks can run."))
    .toBeVisible();
  await expect
    .element(page.getByRole("switch", { name: "Lineup checks for Alpha" }))
    .toHaveAttribute("aria-checked", "true");
});

it("keeps quiet rows to league context and the last check", async () => {
  using _app = setupTeamsPage([enabledTeam]);

  await expect.element(page.getByText("Football · NFL 2026")).toBeVisible();
  await expect
    .element(page.getByText(`Last check changed nothing · ${formatReaderTime(twoHoursAgo)}`))
    .toBeVisible();
  await expect.element(page.getByText("Available")).not.toBeInTheDocument();
  await expect.element(page.getByText("Connected")).not.toBeInTheDocument();
  await expect.element(page.getByText("Lineup checks on")).not.toBeInTheDocument();
  await expect.element(page.getByText("Reconnect Yahoo")).not.toBeInTheDocument();
});

it("says what the last check did and tallies the checks that changed the lineup", async () => {
  using _app = setupTeamsPage([
    { ...enabledTeam, lastRun: changedRun, recentRuns: [changedRun, noOpRun, noOpRun] },
  ]);

  await expect
    .element(page.getByText(`Last check changed 2 players · ${formatReaderTime(twoHoursAgo)}`))
    .toBeVisible();
  await expect.element(page.getByText("1 of the last 3 checks changed the lineup")).toBeVisible();
});

it("shows the provider's own unavailability as attention", async () => {
  using _app = setupTeamsPage([
    { ...enabledTeam, team: { ...enabledTeam.team, availability: "unavailable" } },
  ]);

  await expect
    .element(
      page.getByText("Yahoo no longer lists this team. Lineup checks skip it until it returns."),
    )
    .toBeVisible();
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

function refusal(reason: TeamMutationError): Error {
  try {
    requireTeamSuccess({ type: "error", error: reason });
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected the server to refuse the change");
}

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
    saveNote: () => Promise.reject(new Error("Unexpected note save")),
    readRoster: () => Promise.resolve({ status: "ok", players: [], observedAt: null }),
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
