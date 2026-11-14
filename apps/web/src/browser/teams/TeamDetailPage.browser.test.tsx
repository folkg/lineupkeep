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

import "#web/styles.css";

import type { RouterContext } from "#browser/app-shell/routerContext.ts";
import { createQueryClient } from "#browser/query/queryClient.ts";
import type { SessionRemote } from "#browser/session/sessionRemote.ts";
import {
  formatClockTime,
  formatDateTime,
  formatRangeEnd,
  formatRangeStart,
  formatReaderTime,
  formatWeekday,
} from "#browser/shared-ui/formatTime.ts";
import type {
  LineupRunView,
  TeamNoteSaveResult,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";

import { TeamDetailPage } from "./TeamDetailPage";
import { quietGroupSpan } from "./teamLabels";
import { teamQueries } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";

const teamId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1";
const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1_000).toISOString();
const hoursAgo = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

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

const nextTickAt = "2026-11-04T22:55:00.000Z";
const nextGameAt = "2026-11-05T00:30:00.000Z";

const skippedRun: LineupRunView = {
  ...noOpRun,
  run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b5",
  status: "skipped",
  updatedAt: hoursAgo(1),
  outcome: {
    kind: "skipped",
    verified: false,
    reconciled: false,
    summary: "No games before the next scheduled check.",
    observedAt: hoursAgo(1),
    nextTickAt,
    nextGameAt,
    changes: [],
    lockedPlayers: 0,
    editablePlayers: 0,
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
    ownerNote: null,
    ownerNoteUpdatedAt: null,
    ownerNoteLimit: 2_000,
    lastSeenAt: threeDaysAgo,
    createdAt: threeDaysAgo,
    updatedAt: threeDaysAgo,
  },
  connectionStatus: "ready",
  connectionCount: 1,
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

it("links to the open moves beside its other actions", async () => {
  using _app = setupTeamDetailPage(team);

  await expect
    .element(page.getByRole("link", { name: "Transactions" }))
    .toHaveAttribute("href", "/transactions");
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
  await expect
    .element(page.getByText("Newest first. Checks that changed nothing are grouped."))
    .not.toBeInTheDocument();
});

it("puts the provider jump out beside the team name and above the controls", async () => {
  using _app = setupTeamDetailPage({
    ...team,
    team: {
      ...team.team,
      leagueName: "Irish Lax",
      providerUrl: "https://provider.example/f1/1000/1",
    },
  });

  await expect.element(page.getByText("Irish Lax · Football · 2026")).toBeVisible();
  const name = page.getByRole("heading", { name: "Alpha" });
  const jumpOut = page.getByRole("link", { name: "Open Alpha in Yahoo" });
  const toggle = page.getByRole("switch", { name: "Lineup checks for Alpha" });
  const context = page.getByText("Irish Lax · Football · 2026");
  await expect.element(jumpOut).toHaveAttribute("href", "https://provider.example/f1/1000/1");

  const nameBox = name.element().getBoundingClientRect();
  const jumpBox = jumpOut.element().getBoundingClientRect();
  expect(jumpBox.left, "the popout sits to the right of the team name").toBeGreaterThanOrEqual(
    nameBox.right,
  );
  expect(
    jumpBox.bottom,
    "the popout sits with the name, not in the control row",
  ).toBeLessThanOrEqual(toggle.element().getBoundingClientRect().top);
  expect(
    jumpOut.element().compareDocumentPosition(context.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
    "the popout comes before the metadata line",
  ).toBeTruthy();
});

it("keeps the popout beside a long team name on a phone", async () => {
  const longName = "Embedded Browser Team With A Long Name";
  using _app = setupTeamDetailPage({
    ...team,
    team: {
      ...team.team,
      name: longName,
      providerUrl: "https://provider.example/f1/1000/1",
    },
  });
  await page.viewport(390, 844);

  const heading = page.getByRole("heading", { name: longName });
  const jumpOut = page.getByRole("link", { name: `Open ${longName} in Yahoo` });
  await expect.element(heading).toBeVisible();
  await expect.element(jumpOut).toBeVisible();

  const headingBox = heading.element().getBoundingClientRect();
  const jumpBox = jumpOut.element().getBoundingClientRect();
  expect(jumpBox.left, "the popout stays to the right of the name").toBeGreaterThanOrEqual(
    headingBox.right,
  );
  expect(jumpBox.bottom, "the popout shares the name's lines").toBeGreaterThan(headingBox.top);
  expect(jumpBox.top).toBeLessThan(headingBox.bottom);
});

it("puts recent activity above the owner note and leaves the roster off the page", async () => {
  using _app = setupTeamDetailPage(team);

  const activity = page.getByRole("heading", { name: "Recent activity" });
  const note = page.getByRole("heading", { name: "Owner note" });
  await expect.element(activity).toBeVisible();
  await expect.element(note).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Roster" })).not.toBeInTheDocument();

  expect(
    activity.element().compareDocumentPosition(note.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  const report = page.getByRole("link", { name: "Report a problem with this team" });
  expect(
    note.element().compareDocumentPosition(report.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("says when the next game is in the reader's local time", async () => {
  using _app = setupTeamDetailPage({ ...team, lastRun: skippedRun, recentRuns: [skippedRun] });

  const sentence = `Nothing to check. Next game is ${formatWeekday(nextGameAt)} at ${formatClockTime(nextGameAt)}.`;
  await expect.element(page.getByText(sentence)).toBeVisible();
  await expect.element(page.getByText(/UTC/u)).not.toBeInTheDocument();
});

it("names the next check in the reader's local time when no game is scheduled", async () => {
  const noGame: LineupRunView = {
    ...skippedRun,
    outcome: {
      kind: "skipped",
      verified: false,
      reconciled: false,
      summary: "No rostered player has a game scheduled.",
      observedAt: hoursAgo(1),
      nextTickAt,
      changes: [],
      lockedPlayers: 0,
      editablePlayers: 0,
    },
  };
  using _app = setupTeamDetailPage({ ...team, lastRun: noGame, recentRuns: [noGame] });

  await expect
    .element(
      page.getByText(`Nothing to check. The next check is at ${formatClockTime(nextTickAt)}.`),
    )
    .toBeVisible();
  await expect.element(page.getByText(/UTC/u)).not.toBeInTheDocument();
});

it("falls back to the stored sentence when an older run has no instants", async () => {
  const older: LineupRunView = {
    ...skippedRun,
    outcome: {
      kind: "skipped",
      verified: false,
      reconciled: false,
      summary: "No games before the next scheduled check.",
      observedAt: hoursAgo(1),
      changes: [],
      lockedPlayers: 0,
      editablePlayers: 0,
    },
  };
  using _app = setupTeamDetailPage({ ...team, lastRun: older, recentRuns: [older] });

  await expect.element(page.getByText("No games before the next scheduled check.")).toBeVisible();
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

it("puts the pause icon beside the lineup checks switch with the full sentence", async () => {
  using _app = setupTeamDetailPage(team);

  const toggle = page.getByRole("switch", { name: "Lineup checks for Alpha" });
  const pause = page.getByRole("button", {
    name: "Pause lineup checks for the rest of the fantasy day",
  });
  await expect
    .element(pause)
    .toHaveAttribute("title", "Pause lineup checks for the rest of the fantasy day");

  const toggleBox = toggle.element().getBoundingClientRect();
  const pauseBox = pause.element().getBoundingClientRect();
  expect(Math.abs(toggleBox.top - pauseBox.top)).toBeLessThanOrEqual(2);
  expect(pauseBox.left).toBeGreaterThanOrEqual(toggleBox.right);
});

it("folds consecutive checks that changed nothing and keeps the rest on their own", async () => {
  const quietRuns = [
    { ...noOpRun, run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c1", updatedAt: hoursAgo(1) },
    { ...noOpRun, run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c2", updatedAt: hoursAgo(2) },
    { ...noOpRun, run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c3", updatedAt: hoursAgo(3) },
  ];
  using _app = setupTeamDetailPage({
    ...team,
    lastRun: changedRun,
    recentRuns: [changedRun, ...quietRuns, failedRun],
  });

  const groupLabel = foldedLabel(quietRuns);
  await expect.element(page.getByText(groupLabel)).toBeVisible();
  await expect.element(page.getByText("Verified 2 native lineup changes.")).toBeVisible();
  await expect.element(page.getByText("The provider rejected the lineup.")).toBeVisible();
  await expect.element(page.getByText(noOpSummary).first()).not.toBeVisible();

  await page.getByText(groupLabel).click();

  await expect.element(page.getByText(noOpSummary).first()).toBeVisible();
  await expect.element(page.getByRole("link", { name: "View run detail" }).first()).toBeVisible();
});

it("collapses a silent stretch with one timestamp to a single time", async () => {
  const timestamp = hoursAgo(2);
  const quietRuns = [
    { ...noOpRun, run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c4", updatedAt: timestamp },
    { ...noOpRun, run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c5", updatedAt: timestamp },
  ];
  using _app = setupTeamDetailPage({
    ...team,
    lastRun: changedRun,
    recentRuns: [changedRun, ...quietRuns, failedRun],
  });

  const groupLabel = foldedLabel(quietRuns);
  expect(groupLabel).toContain(" at ");
  await expect.element(page.getByText(groupLabel)).toBeVisible();
  await expect.element(page.getByText(/changed nothing from .+ to .+/u)).not.toBeInTheDocument();
});

it("folds three silent stretches between the runs that mattered", async () => {
  const first = [
    { ...noOpRun, run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d1", updatedAt: hoursAgo(11) },
    { ...noOpRun, run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d2", updatedAt: hoursAgo(10) },
  ];
  const second = [
    { ...noOpRun, run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d3", updatedAt: hoursAgo(7) },
    { ...noOpRun, run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d4", updatedAt: hoursAgo(6) },
  ];
  const third = [
    { ...noOpRun, run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d5", updatedAt: hoursAgo(3) },
    { ...noOpRun, run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d6", updatedAt: hoursAgo(2) },
  ];
  const secondChange = {
    ...changedRun,
    run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d7",
    updatedAt: hoursAgo(9),
  };
  const failure = { ...failedRun, updatedAt: hoursAgo(5) };
  const runs = [
    { ...changedRun, updatedAt: hoursAgo(12) },
    ...first,
    secondChange,
    ...second,
    failure,
    ...third,
  ];
  using _app = setupTeamDetailPage({ ...team, lastRun: runs[0], recentRuns: runs });

  await expect.element(page.getByText("Verified 2 native lineup changes.").first()).toBeVisible();
  await expect.element(page.getByText("The provider rejected the lineup.")).toBeVisible();
  await expect
    .element(
      page
        .getByRole("listitem")
        .filter({ hasText: "The provider rejected the lineup." })
        .getByRole("link", { name: "View run detail" }),
    )
    .toHaveAttribute("href", `/runs/${failure.run}`);

  for (const group of [first, second, third]) {
    const label = foldedLabel(group);
    const item = page.getByRole("listitem").filter({ hasText: label });

    await expect.element(page.getByText(label)).toBeVisible();
    await page.getByText(label).click();

    for (const [index, run] of group.entries()) {
      await expect
        .element(item.getByRole("link", { name: "View run detail" }).nth(index))
        .toHaveAttribute("href", `/runs/${run.run}`);
    }
  }
});

it("leaves a lone quiet check on its own line", async () => {
  using _app = setupTeamDetailPage({ ...team, lastRun: noOpRun, recentRuns: [noOpRun] });

  await expect.element(page.getByText(noOpSummary)).toBeVisible();
  await expect.element(page.getByText(/changed nothing between/u)).not.toBeInTheDocument();
});

it("says what the fantasy day holds when no checks ran today", async () => {
  using _app = setupTeamDetailPage({ ...team, lastRun: noOpRun, recentRuns: [] });

  await expect.element(page.getByText("No checks today.")).toBeVisible();
  await expect
    .element(page.getByText(`The last check was ${formatReaderTime(noOpRun.updatedAt)}.`))
    .toBeVisible();
});

it("says what will happen when a team has never checked", async () => {
  using _app = setupTeamDetailPage({ ...team, lastRun: undefined, recentRuns: [] });

  await expect.element(page.getByText("No checks today.")).toBeVisible();
  await expect
    .element(page.getByText("Checks will appear here after the first scheduled or manual run."))
    .toBeVisible();
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
  expect(url.searchParams.get("teamName")).toBe("Alpha");
});

it("saves an owner note explicitly and confirms it", async () => {
  const captured: Array<{ readonly team: string; readonly note: string }> = [];
  using _app = setupTeamDetailPage(team, {
    saveNote: (input) => {
      captured.push(input);
      return Promise.resolve({
        outcome: "saved",
        note: input.note,
        updatedAt: threeDaysAgo,
      });
    },
  });

  const note = page.getByLabelText("Note for this team");
  await note.fill("Keep both goalies through 2027.");
  await expect.element(page.getByText("31 of 2000 characters")).toBeVisible();
  await expect.element(page.getByText(/Up to 2000 characters/u)).not.toBeInTheDocument();
  await expect.element(page.getByText(/does not store passwords/u)).not.toBeInTheDocument();
  const save = page.getByRole("button", { name: "Save note" });
  await save.click();

  await expect.element(save).toHaveAttribute("data-state", "done");
  expect(save.element().querySelector('[data-action-mark="tick"]')).not.toBeNull();
  expect(page.getByText("Note saved.").elements()).toHaveLength(1);
  expect(captured).toEqual([{ team: teamId, note: "Keep both goalies through 2027." }]);
});

it("shows the stored owner note when the team loads", async () => {
  const noted: TeamSummaryView = {
    ...team,
    team: {
      ...team.team,
      ownerNote: "Dynasty league. Keeper cost rises by five each season.",
      ownerNoteUpdatedAt: threeDaysAgo,
    },
  };
  using _app = setupTeamDetailPage(noted);

  await expect
    .element(page.getByLabelText("Note for this team"))
    .toHaveValue("Dynasty league. Keeper cost rises by five each season.");
});

it("saves a note that contains a token-shaped value", async () => {
  const captured: string[] = [];
  const token =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  using _app = setupTeamDetailPage(team, {
    saveNote: (input) => {
      captured.push(input.note);
      return Promise.resolve({
        outcome: "saved",
        note: input.note,
        updatedAt: threeDaysAgo,
      });
    },
  });

  const note = page.getByLabelText("Note for this team");
  await note.fill(`Reconnect with ${token}`);
  const save = page.getByRole("button", { name: "Save note" });
  await save.click();

  await expect.element(save).toHaveAttribute("data-state", "done");
  expect(page.getByText("Note saved.").elements()).toHaveLength(1);
  await expect.element(page.getByText(/does not store passwords/u)).not.toBeInTheDocument();
  expect(captured).toEqual([`Reconnect with ${token}`]);
});

it("refuses a note past the stated limit", async () => {
  const captured: string[] = [];
  using _app = setupTeamDetailPage(team, {
    saveNote: (input) => {
      captured.push(input.note);
      return Promise.reject(new Error("The note should not be sent"));
    },
  });

  const note = page.getByLabelText("Note for this team");
  await note.fill("a".repeat(2_001));
  await expect.element(page.getByText("2001 of 2000 characters")).toBeVisible();
  await page.getByRole("button", { name: "Save note" }).click();

  await expect.element(page.getByText(/Shorten it and save again/)).toBeVisible();
  expect(captured).toEqual([]);
});

it("confirms before navigation discards an unsaved note", async () => {
  using _app = setupTeamDetailPage(team);
  await page.getByLabelText("Note for this team").fill("Unsaved keeper note");
  await page.getByRole("link", { name: "Back to teams" }).click();

  await expect.element(page.getByText("Discard unfinished work?")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();

  await expect
    .element(page.getByLabelText("Note for this team"))
    .toHaveValue("Unsaved keeper note");
});

function foldedLabel(runs: ReadonlyArray<LineupRunView>): string {
  const span = quietGroupSpan(runs);
  const start = formatRangeStart(span.from, span.to);
  const end = formatRangeEnd(span.from, span.to);
  return span.from === span.to
    ? `${String(span.count)} checks changed nothing at ${start}`
    : `${String(span.count)} checks changed nothing from ${start} to ${end}`;
}

function setupTeamDetailPage(
  teamSummary: TeamSummaryView,
  overrides: Partial<Pick<TeamRemote, "saveNote">> = {},
): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const remote: TeamRemote = {
    list: () => Promise.resolve([teamSummary]),
    refresh: () => Promise.resolve({ teams: [teamSummary] }),
    control: () => Promise.resolve({ changed: [], teams: [teamSummary] }),
    readRun: () => Promise.reject(new Error("Unexpected run read")),
    saveNote:
      overrides.saveNote ??
      ((input) =>
        Promise.resolve<TeamNoteSaveResult>({
          outcome: "saved",
          note: input.note === "" ? null : input.note,
          updatedAt: input.note === "" ? null : threeDaysAgo,
        })),
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
  const transactionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/transactions",
    component: () => <p>Transactions</p>,
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
    routeTree: rootRoute.addChildren([
      teamsRoute,
      teamRoute,
      transactionsRoute,
      feedbackRoute,
      runRoute,
    ]),
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
