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
import { formatClockTime, formatWeekday } from "#browser/shared-ui/formatTime.ts";
import type { LineupRunView, TeamSummaryView } from "#contracts/connections/teamContract.ts";

import { RunDetailPage } from "./RunDetailPage";
import { teamQueries } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";

const teamId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1";
const observedAt = new Date(Date.now() - 60_000).toISOString();

const run: LineupRunView = {
  run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b1",
  request: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b2",
  team: teamId,
  target: { coverage: "week", week: 3 },
  trigger: "scheduled",
  implementation: "custom_policy",
  implementationVersion: "custom-policy/2",
  status: "completed",
  attempts: 1,
  createdAt: observedAt,
  updatedAt: observedAt,
  outcome: {
    kind: "changed",
    verified: true,
    reconciled: false,
    summary: "Healthy Skater (IR) was left in place. Verified 2 explicit lineup changes.",
    observedAt,
    provenance: { kind: "planned", label: "yahoo/projected rank for week 3" },
    changes: [
      { name: "Bench Runner", from: "BN", to: "RB" },
      { name: "Starting Runner", from: "RB", to: "BN" },
    ],
    leftInPlace: [
      {
        name: "Healthy Skater",
        slot: "IR",
        reason:
          "The league no longer lists them as eligible for this reserve slot, so the plan leaves them there.",
      },
    ],
    lockedPlayers: 0,
    editablePlayers: 4,
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
      changedAt: observedAt,
    },
    ownerNote: null,
    ownerNoteUpdatedAt: null,
    ownerNoteLimit: 2_000,
    lastSeenAt: observedAt,
    createdAt: observedAt,
    updatedAt: observedAt,
  },
  connectionStatus: "ready",
  connectionCount: 1,
  lastRun: run,
  recentRuns: [run],
};

it("names the player left in place and says why", async () => {
  using _app = setupRunDetailPage(run);

  await expect.element(page.getByRole("heading", { name: "Left in place" })).toBeVisible();
  await expect.element(page.getByText("Healthy Skater")).toBeVisible();
  await expect.element(page.getByText("IR", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText(
        "The league no longer lists them as eligible for this reserve slot, so the plan leaves them there.",
      ),
    )
    .toBeVisible();
});

it("says which score decided the plan", async () => {
  using _app = setupRunDetailPage(run);

  await expect
    .element(page.getByText("Scored from yahoo/projected rank for week 3."))
    .toBeVisible();
});

it("shows a finished run as started and finished, without a last update", async () => {
  using _app = setupRunDetailPage(run);

  await expect.element(page.getByText("Started", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Finished", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Updated", { exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByText("Last updated", { exact: true })).not.toBeInTheDocument();
});

it("shows a working run as started and updated, without a finish time", async () => {
  using _app = setupRunDetailPage({ ...run, status: "reading", outcome: undefined });

  await expect.element(page.getByText("Started", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Updated", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Finished", { exact: true })).not.toBeInTheDocument();
});

it("puts the report action last, after everything the run found", async () => {
  using _app = setupRunDetailPage(run);

  const found = page.getByRole("heading", { name: "What the run found" });
  const allTeams = page.getByRole("link", { name: "All teams" });
  const report = page.getByRole("link", { name: "Report a problem with this run" });
  await expect.element(report).toBeVisible();
  expect(
    found.element().compareDocumentPosition(report.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    allTeams.element().compareDocumentPosition(report.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("says when the next game is in the reader's local time", async () => {
  const nextTickAt = "2026-11-04T22:55:00.000Z";
  const nextGameAt = "2026-11-05T00:30:00.000Z";
  using _app = setupRunDetailPage({
    ...run,
    status: "skipped",
    outcome: {
      kind: "skipped",
      verified: false,
      reconciled: false,
      summary: "No games before the next scheduled check.",
      observedAt,
      nextTickAt,
      nextGameAt,
      changes: [],
      lockedPlayers: 0,
      editablePlayers: 0,
    },
  });

  await expect
    .element(
      page.getByText(
        `Nothing to check. Next game is ${formatWeekday(nextGameAt)} at ${formatClockTime(nextGameAt)}.`,
      ),
    )
    .toBeVisible();
  await expect.element(page.getByText(/UTC/u)).not.toBeInTheDocument();
});

it("names the refusal when the custom policy could not score the league", async () => {
  using _app = setupRunDetailPage({
    ...run,
    status: "blocked",
    outcome: {
      kind: "blocked",
      verified: false,
      reconciled: false,
      summary:
        "The provider published no started percentage for any player on this roster, so the custom policy cannot value the lineup.",
      observedAt,
      changes: [],
      provenance: {
        kind: "refused",
        label: "yahoo/policy:no-start-rate",
        detail:
          "The provider published no started percentage for any player on this roster, so the custom policy cannot value the lineup.",
      },
      lockedPlayers: 0,
      editablePlayers: 0,
    },
  });

  await expect
    .element(page.getByText("Not scored by the custom policy (yahoo/policy:no-start-rate)."))
    .toBeVisible();
});

function setupRunDetailPage(lineupRun: LineupRunView): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const remote: TeamRemote = {
    list: () => Promise.resolve([team]),
    refresh: () => Promise.resolve({ teams: [team] }),
    control: () => Promise.resolve({ changed: [], teams: [team] }),
    readRun: () => Promise.resolve({ run: lineupRun }),
    saveNote: () => Promise.reject(new Error("Unexpected note save")),
  };
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
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/runs/$runId",
    component: () => (
      <RunDetailPage
        runId={lineupRun.run}
        runQuery={() => teamQueries.run(remote, lineupRun.run)}
        teamsQuery={() => teamQueries.list(remote)}
        remote={remote}
        onRefresh={() => Promise.resolve()}
      />
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
    component: () => <p>Team</p>,
  });
  const feedbackRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feedback",
    component: () => <p>Feedback</p>,
  });
  const router = createRouter({
    context: { queryClient, sessionRemote },
    history: createMemoryHistory({ initialEntries: [`/runs/${lineupRun.run}`] }),
    routeTree: rootRoute.addChildren([runRoute, teamsRoute, teamRoute, feedbackRoute]),
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
