import { EffectArray, EffectString } from "@lineupkeep/collections";
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
import { createSignal } from "solid-js";
import { expect, it } from "vitest";

import "#web/styles.css";

import { page } from "vitest/browser";

import type { RouterContext } from "#browser/app-shell/routerContext.ts";
import { applyTheme } from "#browser/app-shell/theme.ts";
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
  TeamCardView,
  TeamNoteSaveResult,
  TeamOverviewView,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";

import { TeamDetailPage } from "./TeamDetailPage";
import { quietGroupSpan } from "./teamLabels";
import { teamQueries } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";
import { TeamSeasonOverview } from "./TeamSeasonOverview";

const teamId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1";
const overviewFixture: TeamOverviewView = {
  format: "head_to_head_categories",
  league: {
    teamCount: 12,
    scoringType: "head",
    scoringLabel: "Head to head, categories",
    weeklyDeadline: "weekly",
    endDate: "2027-04-10",
    gamesCaps: { gamesPlayed: 162, inningsPitched: 1400 },
  },
  seasonProgress: { currentPeriod: 11, lastPeriod: 18, endDate: "2027-04-10" },
  standing: { rank: 3, points: 0, pointsFor: 0, pointsAgainst: 120, pointsBack: 0 },
  record: { wins: 7, losses: 3, ties: 0, percentage: 0.7 },
  matchup: {
    week: 11,
    opponent: "Beta",
    points: 0,
    opponentPoints: 42,
    projectedPoints: 63.5,
    opponentProjectedPoints: 55,
    remainingGames: 0,
    opponentRemainingGames: 2,
    statusLabel: "Live",
    categories: [
      { name: "Goals", scoring: undefined, own: 0, opponent: 3 },
      { name: "Shots", scoring: "informational", own: 12, opponent: 8 },
    ],
  },
  gamesUsage: {
    status: "available",
    games: [{ position: "C", played: 0, projected: 150 }],
    innings: { pitched: 10.1, projected: 1300.5 },
  },
};
const tenCategoryOverview: TeamOverviewView = {
  ...overviewFixture,
  gamesUsage: undefined,
  seasonProgress: {
    currentPeriod: 11,
    lastPeriod: 18,
    usesPlayoffs: true,
    playoffStartWeek: 15,
    endDate: "2027-04-10",
  },
  league: {
    teamCount: 12,
    scoringType: "head",
    scoringLabel: "Head to head, categories",
    weeklyDeadline: "weekly",
    endDate: "2027-04-10",
    gamesCaps: {},
  },
  matchup: {
    week: 11,
    opponent: "Beta",
    points: 0,
    opponentPoints: 42,
    projectedPoints: 63.5,
    opponentProjectedPoints: 55,
    remainingGames: 0,
    opponentRemainingGames: 2,
    statusLabel: "Live",
    categories: Array.from({ length: 10 }, (_, index) => ({
      name: `Category ${String(index + 1)}`,
      scoring: undefined,
      own: index,
      opponent: index + 1,
    })),
  },
};

const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1_000).toISOString();
const cardFixture: TeamCardView = {
  summary: {
    team: {
      id: teamId,
      connectionId: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a2",
      provider: "yahoo",
      providerTeamKey: "466.l.4000.t.1",
      providerLeagueKey: "466.l.4000",
      league: "nfl",
      sport: "football",
      season: 2026,
      name: "Alpha",
      leagueName: "League",
      availability: "available",
      automation: { status: "enabled", changedAt: threeDaysAgo },
      ownerNote: null,
      ownerNoteUpdatedAt: null,
      ownerNoteLimit: 2000,
      lastSeenAt: threeDaysAgo,
      createdAt: threeDaysAgo,
      updatedAt: threeDaysAgo,
    },
    connectionStatus: "ready",
    connectionCount: 1,
    recentRuns: [],
  },
  season: {
    format: "head_to_head_categories",
    seasonOver: false,
    scoringLabel: "Head to head, categories",
    scoringType: "head",
    teamCount: 12,
    weeklyDeadline: "weekly",
    startDate: "2026-09-01",
    endDate: "2027-04-10",
    currentWeek: 11,
    endWeek: 18,
    usesPlayoffs: undefined,
    playoffStartWeek: undefined,
    maxGamesPlayed: 162,
    maxInningsPitched: 1400,
    standing: {
      rank: 3,
      record: { wins: 7, losses: 3, ties: 0, percentage: 0.7 },
      points: 0,
      pointsFor: 0,
      pointsAgainst: 120,
      pointsBack: 0,
    },
    matchup: {
      week: 11,
      opponent: "Beta",
      points: 0,
      opponentPoints: 42,
      projectedPoints: 63.5,
      opponentProjectedPoints: 55,
      remainingGames: 0,
      opponentRemainingGames: 2,
      statusLabel: "Live",
      categories: [
        { name: "Goals", scoring: undefined, own: 5, opponent: 2, result: "win" },
        { name: "Shots", scoring: "informational", own: 12, opponent: 8, result: "win" },
      ],
    },
  },
};

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
  using _app = setupTeamDetailPage(team, { overview: () => Promise.resolve(overviewFixture) });

  const back = page.getByRole("link", { name: "All teams" });
  await expect.element(back).toHaveAttribute("href", "/teams");
  expect(back.element().textContent).toContain("All teams");
  expect(back.element().className).toContain("text-meta");
  await expect.element(page.getByRole("heading", { level: 2, name: "This week" })).toBeVisible();
  const title = page.getByRole("heading", { level: 1, name: "Alpha" }).element();
  const section = page.getByRole("heading", { level: 2, name: "This week" }).element();
  expect(title.className).toContain("text-name-title");
  expect(Number.parseFloat(getComputedStyle(title).fontSize)).toBeGreaterThan(
    Number.parseFloat(getComputedStyle(section).fontSize),
  );
  const times = [...document.querySelectorAll<HTMLTimeElement>(`time[datetime="${threeDaysAgo}"]`)];
  expect(times.length).toBeGreaterThan(0);
  expect(EffectArray.every(times, (time) => time.textContent.length > 0)).toBe(true);
});

it("leaves a generic transactions shortcut out of the team header", () => {
  using _app = setupTeamDetailPage(team);

  expect(page.getByRole("link", { name: "Transactions", exact: true }).elements()).toHaveLength(0);
});

it("names the league context and keeps quiet states off the page", async () => {
  using _app = setupTeamDetailPage(team);

  await expect.element(page.getByText("Football · NFL 2026")).toBeVisible();
  await expect.element(page.getByText("Connected")).not.toBeInTheDocument();
  await expect.element(page.getByText("Available")).not.toBeInTheDocument();
  await expect.element(page.getByText(/lists this team/)).not.toBeInTheDocument();
  await expect
    .element(page.getByText("Lineup settings and check history for this team."))
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

it("puts lineup runs above the owner note and leaves the roster off the page", async () => {
  using _app = setupTeamDetailPage(team);

  const activity = page.getByRole("heading", { name: "Lineup runs" });
  const note = page.getByRole("heading", { name: "Owner note" });
  await expect.element(activity).toBeVisible();
  await expect.element(note).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Roster" })).not.toBeInTheDocument();

  expect(
    activity.element().compareDocumentPosition(note.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  const report = page.getByRole("link", { name: "Report a problem with this team" });
  expect(report.element().closest("footer")).not.toBeNull();
  expect(
    note.element().compareDocumentPosition(report.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("says when the next game is in the reader's local time", async () => {
  using _app = setupTeamDetailPage({ ...team, lastRun: skippedRun, recentRuns: [skippedRun] });

  const sentence = `Nothing to check. Next game is ${formatWeekday(nextGameAt)} at ${formatClockTime(nextGameAt)}.`;
  await expect.element(page.getByText(sentence)).toBeVisible();
  expect(page.getByRole("link", { name: "View run detail" }).elements()).toHaveLength(0);
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
  expect(page.getByText(noOpSummary).elements()).toHaveLength(0);
  expect(
    page
      .getByRole("listitem")
      .filter({ hasText: groupLabel })
      .getByRole("link", { name: "View run detail" })
      .elements(),
  ).toHaveLength(0);
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
  await expect.element(page.getByText(/made no change from .+ to .+/u)).not.toBeInTheDocument();
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
    expect(item.getByRole("link", { name: "View run detail" }).elements()).toHaveLength(0);
  }
});

it("folds a lone quiet check into a summary without a link", async () => {
  using _app = setupTeamDetailPage({ ...team, lastRun: noOpRun, recentRuns: [noOpRun] });

  await expect.element(page.getByText(foldedLabel([noOpRun]))).toBeVisible();
  expect(page.getByText(noOpSummary).elements()).toHaveLength(0);
  expect(page.getByRole("link", { name: "View run detail" }).elements()).toHaveLength(0);
});

it("says what the fantasy day holds when no checks ran today", async () => {
  using _app = setupTeamDetailPage({ ...team, lastRun: noOpRun, recentRuns: [] });

  await expect.element(page.getByText("No lineup runs today.")).toBeVisible();
  await expect
    .element(page.getByText(`The last lineup run was ${formatReaderTime(noOpRun.updatedAt)}.`))
    .toBeVisible();
});

it("says what will happen when a team has never checked", async () => {
  using _app = setupTeamDetailPage({ ...team, lastRun: undefined, recentRuns: [] });

  await expect.element(page.getByText("No lineup runs today.")).toBeVisible();
  await expect
    .element(
      page.getByText("Lineup runs will appear here after the first scheduled or manual run."),
    )
    .toBeVisible();
});

it("links a team report to the feedback form with the team reference", async () => {
  using _app = setupTeamDetailPage(team);

  const report = page.getByRole("link", { name: "Report a problem with this team" });
  await expect.element(report).toBeVisible();
  expect(report.element().closest("footer")).not.toBeNull();
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
  await note.fill(EffectString.repeat("a", 2_001));
  await expect.element(page.getByText("2001 of 2000 characters")).toBeVisible();
  await page.getByRole("button", { name: "Save note" }).click();

  await expect.element(page.getByText(/Shorten it and save again/)).toBeVisible();
  expect(captured).toEqual([]);
});

it("confirms before navigation discards an unsaved note", async () => {
  using _app = setupTeamDetailPage(team);
  await page.getByLabelText("Note for this team").fill("Unsaved keeper note");
  await page.getByRole("link", { name: "All teams" }).click();

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
  const runWord = span.count === 1 ? "lineup run" : "lineup runs";
  return span.from === span.to
    ? `${String(span.count)} ${runWord} made no change at ${start}`
    : `${String(span.count)} ${runWord} made no change from ${start} to ${end}`;
}

it("shows season facts, both matchup sides, category detail, and cap usage", async () => {
  using _app = setupTeamDetailPage(team, { overview: () => Promise.resolve(overviewFixture) });

  await expect.element(page.getByText("Categories")).toBeVisible();
  await expect.element(page.getByText("Week 11 vs Beta")).toBeVisible();
  await expect.element(page.getByText("Week 11 of 18")).toBeVisible();
  await expect.element(page.getByText("0-0-0").first()).toBeVisible();
  await expect.element(page.getByText("0 games left · 2 for them")).toBeVisible();
  const matchupTable = page.getByRole("table", { name: "Matchup categories" }).element();
  expect(
    EffectArray.map([...matchupTable.querySelectorAll("th")], (cell) => cell.textContent),
  ).toEqual(["Category", "You", "Them"]);
  const matchupCells = matchupTable.querySelectorAll<HTMLTableCellElement>("tbody td");
  const ownValue = matchupCells[1]?.querySelector("p");
  const theirValue = matchupCells[2]?.querySelector("p");
  expect(Number(getComputedStyle(ownValue ?? document.body).fontWeight)).toBeLessThan(
    Number(getComputedStyle(theirValue ?? document.body).fontWeight),
  );
  await expect.element(page.getByText("0 played · 150 projected")).toBeVisible();
  await expect.element(page.getByText("10.1 pitched · 1,300.5 projected")).toBeVisible();
  await expect.element(page.getByText("7-3-0 (.700)")).toBeVisible();
  expect(page.getByText("0 to 42").elements()).toHaveLength(0);
  expect(page.getByText("Projected 63.5 to 55").elements()).toHaveLength(0);
  const prose = page.getByText("Categories").element();
  expect(getComputedStyle(prose).fontVariantNumeric).not.toBe("tabular-nums");
  expect(page.getByText("0 to 3").elements()).toHaveLength(0);
  expect(page.getByText("Shots (info)").elements()).toHaveLength(0);
  expect(page.getByText("12 to 8").elements()).toHaveLength(0);
  const season = page.getByRole("region", { name: "This week" }).element();
  expect(season.querySelector("dl")).toBeNull();
});

it("aligns the season and week headings and fits the category table", async () => {
  await page.viewport(1440, 900);
  using _app = setupTeamDetailPage(team, { overview: () => Promise.resolve(overviewFixture) });

  await expect.element(page.getByRole("heading", { name: "This week" })).toBeVisible();
  const week = page.getByRole("heading", { name: "This week" }).element();
  const season = page.getByRole("heading", { name: "Season" }).element();
  expect(
    Math.abs(week.getBoundingClientRect().top - season.getBoundingClientRect().top),
  ).toBeLessThanOrEqual(1);
  const table = page.getByRole("table", { name: "Matchup categories" }).element();
  const scroller = table.parentElement;
  expect(scroller?.scrollWidth ?? 0).toBeLessThanOrEqual(scroller?.clientWidth ?? 0);
});

it("gives head-to-head point scores two decimal places", async () => {
  using _app = setupTeamDetailPage(team, {
    overview: () =>
      Promise.resolve({
        ...overviewFixture,
        format: "head_to_head_points",
        standing: { rank: 3, points: 0, pointsFor: 0, pointsAgainst: 120, pointsBack: 0 },
        matchup: {
          week: 11,
          opponent: "Beta",
          points: 0,
          opponentPoints: 0,
          projectedPoints: 63.5,
          opponentProjectedPoints: 55,
          remainingGames: 0,
          opponentRemainingGames: 2,
          categories: [],
        },
      }),
  });

  await expect.element(page.getByText("0.00 to 0.00")).toBeVisible();
  await expect.element(page.getByText("Projected 63.50 to 55.00")).toBeVisible();
  const score = page.getByText("0.00 to 0.00").element();
  expect(getComputedStyle(score).fontVariantNumeric).not.toBe("tabular-nums");
});

it("names the regular season and playoff weeks from the league settings", async () => {
  using _app = setupTeamDetailPage(team, {
    overview: () =>
      Promise.resolve({
        ...overviewFixture,
        seasonProgress: {
          currentPeriod: 11,
          lastPeriod: 18,
          usesPlayoffs: true,
          playoffStartWeek: 15,
          endDate: "2027-04-10",
        },
      }),
  });

  await expect.element(page.getByText("Week 11 of 14 regular", { exact: true })).toBeVisible();
  await expect.element(page.getByText("3 regular weeks left", { exact: true })).toBeVisible();
  await expect.element(page.getByText("4 playoff weeks", { exact: true })).toBeVisible();
});

it("shows rotisserie categories with the stat, place, and points", async () => {
  using _app = setupTeamDetailPage(team, {
    overview: () =>
      Promise.resolve({
        ...overviewFixture,
        format: "rotisserie",
        record: undefined,
        matchup: undefined,
        standing: {
          rank: 7,
          points: 70.5,
          pointsFor: null,
          pointsAgainst: null,
          pointsBack: null,
        },
        league: {
          teamCount: 13,
          scoringType: "roto",
          scoringLabel: "Rotisserie",
          gamesCaps: {},
        },
        categoryPoints: [
          { name: "Goals", scoring: undefined, value: 10, total: 84, place: 4 },
          { name: "Goals against", scoring: "informational", value: null, total: 114, place: null },
          { name: "Save percentage", scoring: undefined, value: 4, total: 0.9, place: 10 },
          {
            name: "Goals Against Average",
            scoring: undefined,
            value: 3,
            total: 1.6,
            place: 11,
          },
        ],
      }),
  });

  const table = page.getByRole("table", { name: "My categories" });
  await expect.element(table).toBeVisible();
  const cells = [...table.element().querySelectorAll<HTMLTableCellElement>("tbody td")];
  expect(EffectArray.map(cells, (cell) => cell.textContent)).toEqual([
    "Goals",
    "84",
    "4th",
    "10",
    "Save percentage",
    "0.900",
    "10th",
    "4",
    "Goals Against Average",
    "1.60",
    "11th",
    "3",
  ]);
  await expect.element(page.getByText("70.5 points", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Total points", { exact: true })).toBeVisible();
  await expect.element(page.getByText("17", { exact: true })).toBeVisible();
  expect(page.getByText("Goals against").elements()).toHaveLength(0);

  await page.viewport(390, 844);
  const scroller = table.element().parentElement;
  expect(scroller?.scrollWidth).toBeLessThanOrEqual(scroller?.clientWidth ?? 0);
});

it("shows the card facts before the detail overview answers", async () => {
  using _app = setupTeamDetailPage(team, {
    cards: () => Promise.resolve([cardFixture]),
    overview: () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve({
              ...overviewFixture,
              matchup: {
                week: 11,
                opponent: "Beta",
                points: 0,
                opponentPoints: 42,
                projectedPoints: 63.5,
                opponentProjectedPoints: 55,
                remainingGames: 0,
                opponentRemainingGames: 2,
                statusLabel: "Live",
                categories: [{ name: "Goals", scoring: undefined, own: 0, opponent: 3 }],
              },
            }),
          1_000,
        ),
      ),
  });

  await expect.element(page.getByText(/2-0-0/u).first()).toBeVisible();
  expect(page.getByText(/0-0-0/u).elements()).toHaveLength(0);
});

it("keeps rotisserie category columns steady while their values load", async () => {
  const season = cardFixture.season;
  if (season === undefined) {
    throw new Error("Expected season facts in the card fixture");
  }
  const pending = Promise.withResolvers<TeamOverviewView>();
  const card: TeamCardView = {
    ...cardFixture,
    season: {
      ...season,
      format: "rotisserie",
      scoringType: "roto",
      scoringLabel: "Rotisserie",
      categoryPoints: [
        { name: "Goals", scoring: undefined, value: null, total: null, place: null },
        { name: "Save percentage", scoring: undefined, value: null, total: null, place: null },
      ],
    },
  };
  using _app = setupTeamDetailPage(team, {
    cards: () => Promise.resolve([card]),
    overview: () => pending.promise,
  });

  const table = page.getByRole("table", { name: "My categories" });
  await expect.element(table).toBeVisible();
  const headers = [...table.element().querySelectorAll<HTMLTableCellElement>("th")];
  const before = EffectArray.map(headers, (header) => {
    const rect = header.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });

  pending.resolve({
    ...overviewFixture,
    format: "rotisserie",
    record: undefined,
    matchup: undefined,
    standing: { rank: 7, points: 70.5, pointsFor: null, pointsAgainst: null, pointsBack: null },
    league: { teamCount: 13, scoringType: "roto", gamesCaps: {} },
    categoryPoints: [
      { name: "Goals", scoring: undefined, value: 10, total: 84, place: 4 },
      { name: "Save percentage", scoring: undefined, value: 4, total: 0.9, place: 10 },
    ],
  });
  await expect.element(page.getByText("0.900")).toBeVisible();

  const settled = [...table.element().querySelectorAll<HTMLTableCellElement>("th")];
  const after = EffectArray.map(settled, (header) => {
    const rect = header.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
  expect(after).toEqual(before);
});

it("shows rotisserie categories from the card without the detail overview", async () => {
  const season = cardFixture.season;
  if (season === undefined) {
    throw new Error("Expected season facts in the card fixture");
  }
  const card: TeamCardView = {
    ...cardFixture,
    season: {
      ...season,
      format: "rotisserie",
      scoringType: "roto",
      scoringLabel: "Rotisserie",
      maxGamesPlayed: undefined,
      maxInningsPitched: undefined,
      categoryPoints: [
        { name: "Goals", scoring: undefined, value: 10, total: 84, place: 4 },
        { name: "Goals against", scoring: "informational", value: null, total: 114, place: null },
        { name: "Save percentage", scoring: undefined, value: 4, total: 0.918, place: 10 },
      ],
    },
  };
  using _app = setupTeamDetailPage(team, {
    cards: () => Promise.resolve([card]),
    overview: () => new Promise(() => {}),
  });

  const table = page.getByRole("table", { name: "My categories" });
  await expect.element(table).toBeVisible();
  const cells = [...table.element().querySelectorAll<HTMLTableCellElement>("tbody td")];
  expect(EffectArray.map(cells, (cell) => cell.textContent)).toEqual([
    "Goals",
    "84",
    "4th",
    "10",
    "Save percentage",
    "0.918",
    "10th",
    "4",
  ]);
  expect(page.getByText("Goals against").elements()).toHaveLength(0);
});

it("reads card facts and the detail overview", async () => {
  const reads: string[] = [];
  using _app = setupTeamDetailPage(team, {
    cards: () => {
      reads.push("cards");
      return Promise.resolve([]);
    },
    overview: () => {
      reads.push("overview");
      return Promise.resolve(overviewFixture);
    },
  });

  await expect.element(page.getByText("Categories")).toBeVisible();
  expect(reads).toEqual(["cards", "overview"]);
});

it.each([
  { format: "head_to_head_categories", label: "Categories" },
  { format: "head_to_head_points", label: "Points" },
  { format: "rotisserie", label: "Rotisserie" },
  { format: "unknown", label: undefined },
] as const)(
  "shows the published $format format when its label is absent",
  async ({ format, label }) => {
    using _app = setupTeamDetailPage(team, {
      overview: () =>
        Promise.resolve({
          ...overviewFixture,
          format,
          league: { teamCount: 12, scoringType: "head", gamesCaps: {}, scoringLabel: undefined },
          leagueReason: "League settings could not be loaded.",
        }),
    });

    if (label === undefined) {
      expect(page.getByText("Unknown scoring format").elements()).toHaveLength(0);
    } else {
      await expect.element(page.getByText(label, { exact: true })).toBeVisible();
    }
    expect(page.getByText("League settings could not be loaded.").elements()).toHaveLength(0);
  },
);

it("shows an unknown format rather than a league read error when settings are missing", async () => {
  using _app = setupTeamDetailPage(team, {
    overview: () =>
      Promise.resolve({
        ...overviewFixture,
        format: undefined,
        league: undefined,
        leagueReason: "League settings could not be loaded.",
      }),
  });

  expect(page.getByText("Unknown scoring format").elements()).toHaveLength(0);
  expect(page.getByText("League settings could not be loaded.").elements()).toHaveLength(0);
  await expect.element(page.getByRole("heading", { name: "This week" })).toBeVisible();
});

it("states why partial and unsupported season facts are missing", async () => {
  await page.viewport(390, 844);
  using _app = setupTeamDetailPage(team, {
    overview: () =>
      Promise.resolve({
        league: {
          teamCount: 12,
          scoringType: "custom",
          scoringLabel: "Custom league scoring",
          weeklyDeadline: "intraday",
          gamesCaps: { gamesPlayed: 162 },
        },
        recordReason: "This format does not publish a win-loss record.",
        standingReason: "Standings were not published.",
        matchupReason: "No current matchup was published.",
        gamesUsage: {
          status: "not_published",
          detail: "The provider did not publish this team's cap usage.",
        },
      }),
  });

  await expect.element(page.getByText("Custom league scoring")).toBeVisible();
  expect(page.getByText("This format does not publish a win-loss record.").elements()).toHaveLength(
    0,
  );
  expect(page.getByText("No current matchup was published.").elements()).toHaveLength(0);
  expect(page.getByText("Usage not published").elements()).toHaveLength(0);
  expect(
    page.getByText("The provider did not publish this team's cap usage.").elements(),
  ).toHaveLength(0);
  expect(page.getByText("Record", { exact: true }).elements()).toHaveLength(0);
  expect(page.getByText("Lineup changes").elements()).toHaveLength(0);
  expect(page.getByText("0 of 162").elements()).toHaveLength(0);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
});

it("does not name a current week after the published last period", () => {
  using _app = setupTeamDetailPage(team, {
    overview: () =>
      Promise.resolve({
        ...overviewFixture,
        seasonProgress: { currentPeriod: 19, lastPeriod: 18, endDate: "2027-04-10" },
      }),
  });
  expect(page.getByText("Season ended").elements()).toHaveLength(0);
  expect(page.getByText("Week 19 of 18").elements()).toHaveLength(0);
  expect(page.getByText("Season ends").elements()).toHaveLength(0);
});

it("keeps controls and activity when season facts are unavailable", async () => {
  using _app = setupTeamDetailPage(team, {
    overview: () => Promise.resolve({ reason: "Season facts are unavailable." }),
  });

  await expect.element(page.getByText("Season facts are unavailable.")).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Lineup runs" })).toBeVisible();
  await expect.element(page.getByRole("switch", { name: "Lineup checks for Alpha" })).toBeVisible();
});

it("keeps the team while its card facts load", async () => {
  const pending = Promise.withResolvers<ReadonlyArray<TeamCardView>>();
  using _app = setupTeamDetailPage(team, {
    cards: () => pending.promise,
    overview: () => Promise.resolve(overviewFixture),
  });

  await expect.element(page.getByRole("heading", { name: "Alpha" })).toBeVisible();
  await expect.element(page.getByLabelText("Loading team")).toBeVisible();
  expect(page.getByText("Team not found.").elements()).toHaveLength(0);
  pending.resolve([]);
  await expect.element(page.getByText("This week", { exact: true })).toBeVisible();
});

it.each([null, 0] as const)(
  "shows points-for only when it is published (%s)",
  async (pointsFor) => {
    using _app = setupTeamDetailPage(team, {
      overview: () =>
        Promise.resolve({
          ...overviewFixture,
          format: "head_to_head_points",
          standing: { rank: 3, points: 99, pointsFor, pointsAgainst: 120, pointsBack: 0 },
        }),
    });
    await expect.element(page.getByText("Points")).toBeVisible();
    if (pointsFor === 0) {
      await expect
        .element(page.getByText("0 points for · 120 against · 0 behind", { exact: true }))
        .toBeVisible();
    } else {
      await expect.element(page.getByText("120 against · 0 behind", { exact: true })).toBeVisible();
    }
    expect(page.getByText("99", { exact: true }).elements()).toHaveLength(0);
  },
);

it.each([
  [390, 844],
  [1440, 900],
] as const)("shows season facts without a placeholder table at %ipx", async (width, height) => {
  await page.viewport(width, height);
  await document.fonts.ready;
  const [facts, setFacts] = createSignal<TeamOverviewView>();
  const host = document.body.appendChild(document.createElement("main"));
  const dispose = render(
    () => (
      <>
        <TeamSeasonOverview facts={facts()} failed={false} />
        <h2>Lineup runs</h2>
      </>
    ),
    host,
  );
  using _app = {
    [Symbol.dispose](): void {
      dispose();
      host.remove();
    },
  };
  expect(host.querySelectorAll(".animate-pulse").length).toBe(0);
  setFacts(tenCategoryOverview);
  await expect.element(page.getByText("Categories")).toBeVisible();
  expect(host.querySelectorAll(".animate-pulse").length).toBe(0);
});

it("captures the team overview at desktop and phone sizes in light and dark", async () => {
  using _app = setupTeamDetailPage(team, { overview: () => Promise.resolve(overviewFixture) });
  await expect.element(page.getByText("10.1 pitched · 1,300.5 projected")).toBeVisible();

  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    await page.viewport(width, height);
    for (const theme of ["light", "dark"] as const) {
      applyTheme(theme);
      await expect.element(page.getByText(/^Week 11 vs Beta/u)).toBeVisible();
      const overview = page.getByRole("region", { name: "This week" }).element();
      expect(overview.querySelector("dl")).toBeNull();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: `../../../../../.artifacts/team-overview-polish/detail-top-${width}x${height}-${theme}.png`,
        save: true,
      });
      page.getByText("10.1 pitched · 1,300.5 projected").element().scrollIntoView();
      await expect.element(page.getByText("10.1 pitched · 1,300.5 projected")).toBeVisible();
      await page.screenshot({
        path: `../../../../../.artifacts/team-overview-polish/detail-caps-${width}x${height}-${theme}.png`,
        save: true,
      });
      window.scrollTo(0, 0);
    }
  }
  applyTheme("light");
});

function setupTeamDetailPage(
  teamSummary: TeamSummaryView,
  overrides: Partial<Pick<TeamRemote, "saveNote" | "overview" | "cards">> = {},
): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const remote: TeamRemote = {
    list: () => Promise.resolve([teamSummary]),
    cards: overrides.cards ?? (() => Promise.resolve([])),
    overview:
      overrides.overview ??
      (() => Promise.resolve({ reason: "Season overview is not available." })),
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
