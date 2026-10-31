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
  TeamNoteSaveResult,
  TeamRosterView,
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
    availability: { status: "available" },
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

it("says a team cannot be read, with the provider's wording, and offers a check", async () => {
  const refused: TeamSummaryView = {
    ...team,
    team: {
      ...team.team,
      availability: {
        status: "unavailable",
        reason: "provider_refused",
        detail: "You are not allowed to view this page because you are not in this league.",
        observedAt: "2026-10-31T16:20:00.000Z",
      },
    },
  };
  using _app = setupTeamDetailPage(refused);

  await expect.element(page.getByText("Lineupkeep cannot read this team.")).toBeVisible();
  await expect
    .element(
      page.getByText("You are not allowed to view this page because you are not in this league."),
    )
    .toBeVisible();
  await expect
    .element(page.getByText(/Observed .*Lineup checks skip it until it can be read\./))
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Check this team again" })).toBeVisible();
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
  await page.getByRole("button", { name: "Save note" }).click();

  await expect.element(page.getByText("Note saved.")).toBeVisible();
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

it("warns about a token-shaped note instead of sending it", async () => {
  const captured: string[] = [];
  const token =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  using _app = setupTeamDetailPage(team, {
    saveNote: (input) => {
      captured.push(input.note);
      return Promise.resolve({
        outcome: "rejected",
        reason: "credential_like",
        message:
          "This looks like a sign-in token. Lineupkeep does not store passwords, tokens, or provider session material in a team note. Remove it and save again.",
      });
    },
  });

  const note = page.getByLabelText("Note for this team");
  await note.fill(`Reconnect with ${token}`);
  await page.getByRole("button", { name: "Save note" }).click();

  await expect.element(page.getByText(/does not store passwords/)).toBeVisible();
  expect(captured).toEqual([`Reconnect with ${token}`]);
  const control = note.element();
  expect(control).toBeInstanceOf(HTMLTextAreaElement);
  if (control instanceof HTMLTextAreaElement) {
    expect(control.value).toContain(token);
  }
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

it("keeps the page usable when the roster read is refused", async () => {
  using _app = setupTeamDetailPage(team, {
    readRoster: () => Promise.reject(new Error("team.roster_unavailable")),
  });

  await expect.element(page.getByRole("heading", { name: "Alpha", level: 1 })).toBeVisible();
  await expect
    .element(
      page.getByText("We could not read this roster from the provider. Try again in a moment."),
    )
    .toBeVisible();
});

it("shows a player's day-window trends and states when none are published", async () => {
  using _app = setupTeamDetailPage(team, {
    readRoster: () =>
      Promise.resolve({
        status: "ok",
        players: [
          {
            name: "Moving Skater",
            slot: { status: "verified", slot: "QB" },
            primaryPosition: "QB",
            displayPosition: "QB",
            proTeam: "SYN",
            injury: { reported: false },
            trend: { status: "published", adds: 37, drops: 3, window: "provider_current_day" },
          },
          {
            name: "Uncounted Skater",
            slot: { status: "verified", slot: "BN" },
            primaryPosition: "WR",
            displayPosition: "WR",
            proTeam: null,
            injury: { reported: true, code: "O", detail: "Out" },
            trend: {
              status: "not_published",
              reason: "The provider published no add and drop counts for this player.",
            },
          },
        ],
        observedAt: "2026-10-30T12:00:00.000Z",
      }),
  });

  await expect.element(page.getByText("Moving Skater")).toBeVisible();
  await expect.element(page.getByText("37 adds and 3 drops today")).toBeVisible();
  await expect.element(page.getByText("QB · SYN")).toBeVisible();
  await expect.element(page.getByText("Uncounted Skater")).toBeVisible();
  await expect
    .element(
      page.getByText(
        "Trends not published. The provider published no add and drop counts for this player.",
      ),
    )
    .toBeVisible();
});

it("states when a player's lineup slot cannot be verified", async () => {
  using _app = setupTeamDetailPage(team, {
    readRoster: () =>
      Promise.resolve({
        status: "ok",
        players: [
          {
            name: "Unplaced Skater",
            slot: {
              status: "unverified",
              rawValue: "",
              reason:
                "The provider published an empty lineup slot for this player, so the slot and the position eligibility it would establish are unverified.",
            },
            primaryPosition: "C",
            displayPosition: "C",
            proTeam: "SYN",
            injury: { reported: false },
            trend: { status: "not_published", reason: "Synthetic absence." },
          },
        ],
        observedAt: "2026-10-30T12:00:00.000Z",
      }),
  });

  await expect.element(page.getByText("Unplaced Skater")).toBeVisible();
  await expect.element(page.getByText("Slot unverified")).toBeVisible();
  await expect
    .element(
      page.getByText(
        "The provider published an empty lineup slot for this player, so the slot and the position eligibility it would establish are unverified.",
      ),
    )
    .toBeVisible();
});

function foldedLabel(runs: ReadonlyArray<LineupRunView>): string {
  const span = quietGroupSpan(runs);
  return `${String(span.count)} checks changed nothing between ${formatDateTime(
    span.from,
  )} and ${formatDateTime(span.to)}`;
}

function setupTeamDetailPage(
  teamSummary: TeamSummaryView,
  overrides: Partial<Pick<TeamRemote, "saveNote" | "readRoster">> = {},
): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const remote: TeamRemote = {
    list: () => Promise.resolve([teamSummary]),
    refresh: () => Promise.resolve({ teams: [teamSummary] }),
    check: () => Promise.resolve({ teams: [teamSummary] }),
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
    readRoster:
      overrides.readRoster ??
      (() =>
        Promise.resolve<TeamRosterView>({
          status: "ok",
          players: [],
          observedAt: null,
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
