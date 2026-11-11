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
import { formatClockTime, formatReaderTime } from "#browser/shared-ui/formatTime.ts";
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
  connectionCount: 1,
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

const checkingRun: LineupRunView = {
  ...noOpRun,
  run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b4",
  status: "verifying",
  outcome: undefined,
};

const queuedRun: LineupRunView = {
  ...checkingRun,
  run: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b5",
  status: "queued",
};

const longName = "Skinner? I barely know her! The second coming of a very long team name";
const longNamedTeam: TeamSummaryView = {
  ...enabledTeam,
  team: { ...enabledTeam.team, id: "018f79ea-7d86-7c18-9b4a-8b4d0c916599", name: longName },
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

it("says what to turn on when no team is being checked", async () => {
  using _app = setupTeamsPage([baseTeam]);

  await expect.element(page.getByText("No teams are being checked.")).toBeVisible();
  await expect
    .element(page.getByText("Turn on Lineup checks for the teams you want managed."))
    .toBeVisible();
});

it("hides the prompt once a team is being checked", async () => {
  using _app = setupTeamsPage([enabledTeam]);

  await expect.element(page.getByText("No teams are being checked.")).not.toBeInTheDocument();
});

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
  const changes: Array<{ readonly team: string; readonly action: string }> = [];
  using _app = setupTeamsPage([baseTeam], {
    control: (input) => {
      changes.push(input);
      return answer.promise;
    },
  });

  const toggle = page.getByRole("switch", { name: "Lineup checks for Alpha" });
  await expect.element(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();

  await expect.element(toggle).toHaveAttribute("aria-checked", "true");
  await expect.element(toggle).toHaveAttribute("aria-busy", "true");
  await expect.element(toggle).toHaveAttribute("disabled");
  await expect.element(toggle).toBeDisabled();
  expect(page.getByText("Turning on…").elements()).toHaveLength(0);

  const control = toggle.element();
  if (control instanceof HTMLButtonElement) {
    control.click();
  }
  expect(changes).toHaveLength(1);

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

it("keeps the pause control in place and disabled while lineup checks are off", async () => {
  using _app = setupTeamsPage([baseTeam]);

  const pause = page.getByRole("button", {
    name: "Pause lineup checks for the rest of the fantasy day",
  });
  const toggle = page.getByRole("switch", { name: "Lineup checks for Alpha" });
  await expect.element(pause).toBeVisible();
  await expect.element(pause).toHaveAttribute("aria-disabled", "true");
  await expect
    .element(pause)
    .toHaveAttribute("title", "Turn on lineup checks to pause the rest of the fantasy day.");
  expect(pause.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(
    toggle.element().getBoundingClientRect().right,
  );
});

it("keeps every control inside a phone viewport without sideways scroll", async () => {
  await page.viewport(390, 844);
  using _app = setupTeamsPage([enabledTeam, longNamedTeam]);

  for (const name of ["Alpha", longName]) {
    const toggle = page.getByRole("switch", { name: `Lineup checks for ${name}` });
    await expect.element(toggle).toBeVisible();
    const bounds = toggle.element().getBoundingClientRect();
    const root = document.documentElement;

    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(root.clientWidth);
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  }
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
        `Paused for the rest of the fantasy day · resumes at ${formatClockTime(
          pausedTeam.team.automation.resumesAt ?? "",
        )}`,
      ),
    )
    .toBeVisible();
  const toggle = page.getByRole("switch", { name: "Lineup checks for Alpha" });
  const resume = page.getByRole("button", { name: "Resume lineup checks" });
  await expect.element(resume).toHaveAttribute("title", "Resume lineup checks");

  const toggleBox = toggle.element().getBoundingClientRect();
  const resumeBox = resume.element().getBoundingClientRect();
  expect(Math.abs(toggleBox.top - resumeBox.top)).toBeLessThanOrEqual(2);
  expect(resumeBox.left).toBeGreaterThanOrEqual(toggleBox.right);

  await resume.click();

  await expect
    .element(page.getByRole("switch", { name: "Lineup checks for Alpha" }))
    .toHaveAttribute("aria-checked", "true");
  await expect
    .element(page.getByText(/^Paused for the rest of the fantasy day/u))
    .not.toBeInTheDocument();
  await expect.element(page.getByText(/^Next check at /u)).toBeVisible();
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

  await pause.click();

  await expect
    .element(
      page.getByText(
        `Paused for the rest of the fantasy day · resumes at ${formatClockTime(
          pausedTeam.team.automation.resumesAt ?? "",
        )}`,
      ),
    )
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Resume lineup checks" })).toBeVisible();
  expect(changes).toEqual([{ team: teamId, action: "pause-today" }]);
});

it("disables the pause control while the switch is saving", async () => {
  const answer = Promise.withResolvers<TeamChangeView>();
  using _app = setupTeamsPage([baseTeam], { control: () => answer.promise });

  await page.getByRole("switch", { name: "Lineup checks for Alpha" }).click();

  const pause = page.getByRole("button", {
    name: "Pause lineup checks for the rest of the fantasy day",
  });
  await expect.element(pause).toHaveAttribute("aria-disabled", "true");
  await expect
    .element(pause)
    .toHaveAttribute("title", "Pause lineup checks for the rest of the fantasy day");

  answer.resolve({ changed: [], teams: [baseTeam] });
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

  const context = page.getByText("Football · NFL 2026");
  await expect.element(context).toBeVisible();
  expect(context.element().textContent).toBe("Football · NFL 2026");
  await expect.element(page.getByText(/^ ·/u)).not.toBeInTheDocument();
  await expect
    .element(page.getByText(`Last check changed nothing · ${formatReaderTime(twoHoursAgo)}`))
    .toBeVisible();
  await expect.element(page.getByText("Available")).not.toBeInTheDocument();
  await expect.element(page.getByText("Connected")).not.toBeInTheDocument();
  await expect.element(page.getByText("Lineup checks on")).not.toBeInTheDocument();
  await expect.element(page.getByText("Reconnect Yahoo")).not.toBeInTheDocument();
  await expect.element(page.getByRole("link", { name: /^Open /u })).not.toBeInTheDocument();
});

it("shows the fantasy league name and a provider jump out for the team", async () => {
  using _app = setupTeamsPage([
    {
      ...enabledTeam,
      team: {
        ...enabledTeam.team,
        leagueName: "Irish Lax",
        providerUrl: "https://provider.example/f1/1000/1",
      },
    },
  ]);

  await expect.element(page.getByText("Irish Lax · Football · 2026")).toBeVisible();
  const jumpOut = page.getByRole("link", { name: "Open Alpha in Yahoo" });
  const name = page.getByRole("link", { name: "Alpha", exact: true });
  const pause = page.getByRole("button", {
    name: "Pause lineup checks for the rest of the fantasy day",
  });
  await expect.element(jumpOut).toHaveAttribute("href", "https://provider.example/f1/1000/1");
  await expect.element(jumpOut).toHaveAttribute("target", "_blank");
  const nameBox = name.element().getBoundingClientRect();
  const jumpBox = jumpOut.element().getBoundingClientRect();
  expect(jumpBox.left).toBeGreaterThanOrEqual(nameBox.right);
  expect(
    jumpOut.element().compareDocumentPosition(pause.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("names the connection only when the account has more than one", async () => {
  using _app = setupTeamsPage([{ ...enabledTeam, connectionCount: 2 }]);

  await expect.element(page.getByText("Football · NFL 2026 · Yahoo")).toBeVisible();
});

it("keeps a team row in the order of name, league, status, last check, and tally", async () => {
  const tally = "1 of the last 3 checks changed the lineup";
  using _app = setupTeamsPage([
    {
      ...enabledTeam,
      team: { ...enabledTeam.team, leagueName: "Elite League 25" },
      lastRun: changedRun,
      recentRuns: [changedRun, noOpRun, noOpRun],
    },
  ]);

  const row = page.getByRole("listitem").filter({ hasText: "Alpha" });
  const name = row.getByRole("link", { name: "Alpha", exact: true });
  const league = row.getByText("Elite League 25 · Football · 2026");
  const status = row.getByText(/^Next check at /u);
  const lastCheck = row.getByText(
    `Last check changed 2 players · ${formatReaderTime(twoHoursAgo)}`,
  );
  const tallyLine = row.getByText(tally);

  await expect.element(name).toBeVisible();
  await expect.element(league).toBeVisible();
  await expect.element(status).toBeVisible();
  await expect.element(lastCheck).toBeVisible();
  await expect.element(tallyLine).toBeVisible();

  for (const later of [league, status, lastCheck, tallyLine]) {
    expect(
      name.element().compareDocumentPosition(later.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
  for (const later of [status, lastCheck, tallyLine]) {
    expect(
      league.element().compareDocumentPosition(later.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
  expect(
    status.element().compareDocumentPosition(lastCheck.element()) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    lastCheck.element().compareDocumentPosition(tallyLine.element()) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("keeps the same row height in every check state on a phone and a desktop", async () => {
  const inFlight = { ...enabledTeam, lastRun: checkingRun, recentRuns: [checkingRun] };
  const states = [
    { name: "checks on", team: enabledTeam },
    { name: "paused", team: pausedTeam },
    { name: "checks off", team: baseTeam },
    { name: "in flight", team: inFlight },
  ];
  const heights: Array<{ width: number; state: string; height: number }> = [];

  for (const width of [390, 1440]) {
    await page.viewport(width, 844);
    for (const state of states) {
      const mounted = setupTeamsPage([state.team]);
      try {
        const row = page.getByRole("listitem").filter({ hasText: "Alpha" });
        await expect.element(row).toBeVisible();
        expect(
          row
            .getByText(/^(Next check at|Paused for the rest|Lineup checks are off|Checking now)/u)
            .element()
            .getBoundingClientRect().height,
          "the status line reserves two lines",
        ).toBe(36);
        heights.push({
          width,
          state: state.name,
          height: row.element().getBoundingClientRect().height,
        });
      } finally {
        mounted[Symbol.dispose]();
      }
    }
  }

  for (const width of [390, 1440]) {
    const measured = heights.filter((entry) => entry.width === width);
    expect(measured, `${width}px measures every state`).toHaveLength(4);
    expect(
      new Set(measured.map((entry) => entry.height)).size,
      `${width}px keeps one row height across ${measured.map((entry) => entry.state).join(", ")}`,
    ).toBe(1);
  }
});

it("says the next check, the pause, checks off, or a check in flight", async () => {
  const mounted = setupTeamsPage([enabledTeam]);
  try {
    await expect.element(page.getByText(/^Next check at \d{1,2}:\d{2}( [ap]m)?$/u)).toBeVisible();
  } finally {
    mounted[Symbol.dispose]();
  }

  const paused = setupTeamsPage([pausedTeam]);
  try {
    await expect
      .element(
        page.getByText(
          `Paused for the rest of the fantasy day · resumes at ${formatClockTime(
            pausedTeam.team.automation.resumesAt ?? "",
          )}`,
        ),
      )
      .toBeVisible();
  } finally {
    paused[Symbol.dispose]();
  }

  const off = setupTeamsPage([baseTeam]);
  try {
    await expect
      .element(
        page.getByText("Lineup checks are off. Turn them on to check this team hourly.", {
          exact: true,
        }),
      )
      .toBeVisible();
  } finally {
    off[Symbol.dispose]();
  }

  const inFlight = setupTeamsPage([
    { ...enabledTeam, lastRun: checkingRun, recentRuns: [checkingRun] },
  ]);
  try {
    await expect
      .element(page.getByText("Checking now. This usually takes under a minute.", { exact: true }))
      .toBeVisible();
  } finally {
    inFlight[Symbol.dispose]();
  }

  const waiting = setupTeamsPage([{ ...enabledTeam, lastRun: queuedRun, recentRuns: [queuedRun] }]);
  try {
    await expect
      .element(page.getByText("A check is waiting to start.", { exact: true }))
      .toBeVisible();
  } finally {
    waiting[Symbol.dispose]();
  }
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

it("shows an empty state before any teams are discovered", async () => {
  using _empty = setupTeamsPage([]);
  await expect.element(page.getByText("No teams yet.")).toBeVisible();
  await expect.element(page.getByText(/^Connect an account to import/u)).toBeVisible();
  await expect.element(page.getByText(/Yahoo/u)).not.toBeInTheDocument();
});

it("shows a recoverable failure instead of an empty team list", async () => {
  using _app = setupTeamsPage(
    [],
    { list: () => Promise.reject(new Error("Network")) },
    { retryDelay: 0 },
  );
  await expect.element(page.getByText("We could not load your teams.")).toBeVisible();
});

it("shows a loading state while the team list is pending", async () => {
  const pending = Promise.withResolvers<ReadonlyArray<TeamSummaryView>>();
  using _app = setupTeamsPage([], { list: () => pending.promise });
  await expect.element(page.getByText("Loading your teams…")).toBeVisible();
  pending.resolve([]);
  await expect.element(page.getByText("No teams yet.")).toBeVisible();
});

it("keeps refresh an icon button with a tooltip and no text label", async () => {
  using _app = setupTeamsPage([baseTeam]);

  const refresh = page.getByRole("button", { name: "Refresh teams" });
  await expect.element(refresh).toHaveAttribute("title", "Refresh teams");
  expect(refresh.element().textContent).toBe("");
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
  await expect
    .element(page.getByRole("button", { name: "Refresh teams" }))
    .toHaveAttribute("data-state", "done");
  expect(page.getByText("Teams refreshed.").elements()).toHaveLength(1);
});

it("keeps the list and reports a failed refresh", async () => {
  using _app = setupTeamsPage([baseTeam], {
    refresh: () =>
      Promise.resolve(
        requireTeamSuccess({ type: "error", error: { type: "team.refresh_failed" } }),
      ),
  });

  await page.getByRole("button", { name: "Refresh teams" }).click();

  await expect.element(page.getByText("We could not refresh your teams. Try again.")).toBeVisible();
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
  queryOptions: { readonly retryDelay?: number } = {},
): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  if (queryOptions.retryDelay !== undefined) {
    queryClient.setDefaultOptions({ queries: { retryDelay: queryOptions.retryDelay } });
  }
  const remote: TeamRemote = {
    list: overrides.list ?? (() => Promise.resolve(teams)),
    refresh: overrides.refresh ?? (() => Promise.resolve({ teams })),
    control: overrides.control ?? (() => Promise.resolve({ changed: [], teams })),
    readRun: () => Promise.reject(new Error("Unexpected run read")),
    saveNote: () => Promise.reject(new Error("Unexpected note save")),
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
