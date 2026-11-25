import { EffectArray } from "@lineupkeep/collections";
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

import "#web/styles.css";

import { page } from "vitest/browser";

import type { RouterContext } from "#browser/app-shell/routerContext.ts";
import { applyTheme } from "#browser/app-shell/theme.ts";
import { createQueryClient } from "#browser/query/queryClient.ts";
import type { SessionRemote } from "#browser/session/sessionRemote.ts";
import { formatClockTime, formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import type {
  LineupRunView,
  TeamChangeView,
  TeamMutationError,
  TeamRefreshView,
  TeamSummaryView,
  TeamCardView,
} from "#contracts/connections/teamContract.ts";

import { scoringLabel } from "./seasonLabels";
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
    scoringFormat: "head_to_head_categories",
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

const standingFacts: NonNullable<NonNullable<TeamCardView["season"]>["standing"]> = {
  rank: 3,
  record: { wins: 7, losses: 3, ties: 0, percentage: 0.7 },
  points: null,
  pointsFor: 1234.5,
  pointsAgainst: 1200,
  pointsBack: 0,
};

const seasonFacts: NonNullable<TeamCardView["season"]> = {
  format: "head_to_head_categories",
  seasonOver: false,
  scoringLabel: "H2H Cat",
  scoringType: "head",
  teamCount: 12,
  weeklyDeadline: "weekly",
  startDate: "2026-09-01",
  endDate: "2027-01-04",
  currentWeek: 11,
  endWeek: 18,
  usesPlayoffs: undefined,
  playoffStartWeek: undefined,
  maxGamesPlayed: 162,
  maxInningsPitched: undefined,
  standing: standingFacts,
};

const seasonCard: TeamCardView = { summary: baseTeam, season: seasonFacts };
const seasonCardWithMatchup: TeamCardView = {
  ...seasonCard,
  season: {
    ...seasonFacts,
    usesPlayoffs: true,
    playoffStartWeek: 15,
    matchup: {
      week: 9,
      opponent: "Beta",
      points: null,
      opponentPoints: null,
      projectedPoints: null,
      opponentProjectedPoints: null,
      remainingGames: 0,
      opponentRemainingGames: 2,
      categories: [
        { name: "Goals", scoring: undefined, own: 5, opponent: 2, result: "win" },
        { name: "Shots", scoring: undefined, own: 3, opponent: 4, result: "loss" },
      ],
    },
  },
};

const tallSeasonCard: TeamCardView = {
  ...seasonCard,
  season: {
    ...seasonFacts,
    format: "rotisserie",
    scoringLabel: undefined,
    maxInningsPitched: 1200,
    standing: { ...standingFacts, record: undefined, pointsAgainst: 0 },
  },
};

it.each([
  { published: "H2H", label: "Head to head" },
  { published: "H2H Cat", label: "Head to head categories" },
  { published: "H2H Categories", label: "Head to head categories" },
  { published: "H2H Points", label: "Head to head points" },
  { published: "H2H Pts", label: "Head to head points" },
  { published: "Roto", label: "Rotisserie" },
  { published: "Custom league scoring", label: "Custom league scoring" },
] as const)("expands published $published", ({ published, label }) => {
  expect(scoringLabel(published)).toBe(label);
});

it("shows the standing and format without a key-value table", async () => {
  using _app = setupTeamsPage([baseTeam], { cards: () => Promise.resolve([seasonCard]) });
  await expect.element(page.getByText("3rd of 12")).toBeVisible();
  await expect.element(page.getByText("7-3-0 (.700)")).toBeVisible();
  await expect.element(page.getByText("Categories")).toBeVisible();
  const card = page.getByRole("listitem").first().element();
  expect(card.textContent).not.toContain("1,234.5");
  expect(card.textContent).not.toContain("1,200");
  expect(card.textContent).not.toContain("behind leader");
  expect(card.querySelector("dl")).toBeNull();
  expect(card.textContent).not.toContain("Weekly");
  await expect.element(page.getByText("Week 11 of 18")).toBeVisible();
  await expect.element(page.getByRole("switch", { name: "Lineup checks for Alpha" })).toBeVisible();
});

it("shows the current matchup at a glance without category rows", async () => {
  using _app = setupTeamsPage([baseTeam], {
    cards: () =>
      Promise.resolve([
        {
          ...seasonCard,
          season: {
            ...seasonFacts,
            matchup: {
              week: 9,
              opponent: "Beta",
              points: 0,
              opponentPoints: 0,
              projectedPoints: 63.5,
              opponentProjectedPoints: 55,
              remainingGames: 0,
              opponentRemainingGames: 2,
              categories: [],
            },
          },
        },
      ]),
  });
  await expect.element(page.getByText(/^Week 9 vs Beta/u)).toBeVisible();
  await expect.element(page.getByText("0-0-0")).toBeVisible();
  expect(page.getByText("0 to 0").elements()).toHaveLength(0);
  expect(page.getByText("Projected 63.5 to 55").elements()).toHaveLength(0);
  await expect.element(page.getByText("Week 9 vs Beta · 0 games left · 2 for them")).toBeVisible();
});

it("gives head-to-head point scores two decimal places", async () => {
  using _app = setupTeamsPage([baseTeam], {
    cards: () =>
      Promise.resolve([
        {
          ...seasonCard,
          season: {
            ...seasonFacts,
            format: "head_to_head_points",
            matchup: {
              week: 9,
              opponent: "Beta",
              points: 0,
              opponentPoints: 0,
              projectedPoints: 63.5,
              opponentProjectedPoints: 55,
              remainingGames: 0,
              opponentRemainingGames: 2,
              categories: [],
            },
          },
        },
      ]),
  });
  await expect.element(page.getByText("0.00 to 0.00")).toBeVisible();
  expect(page.getByText("0.00 to 0.00").elements()).toHaveLength(1);
  await expect.element(page.getByText("Projected 63.50 to 55.00")).toBeVisible();
  const matchup = page.getByText(/^Week 9 vs Beta/u).element();
  const score = page.getByText("0.00 to 0.00").element();
  expect(getComputedStyle(score).fontVariantNumeric).not.toBe("tabular-nums");
  expect(Number(getComputedStyle(matchup).fontWeight)).toBeLessThan(
    Number(getComputedStyle(score).fontWeight),
  );
});

it("shows missing facts without a made-up record, label, cap or weekly lock", async () => {
  using _app = setupTeamsPage([baseTeam], {
    cards: () =>
      Promise.resolve([
        {
          ...seasonCard,
          season: {
            ...seasonFacts,
            format: "head_to_head_points",
            scoringLabel: undefined,
            weeklyDeadline: "",
            maxGamesPlayed: 0,
            currentWeek: undefined,
            endWeek: undefined,
            standing: {
              rank: 1,
              record: undefined,
              points: null,
              pointsFor: 0,
              pointsAgainst: null,
              pointsBack: null,
            },
          },
        },
      ]),
  });
  await expect.element(page.getByText("0 points for", { exact: true })).toBeVisible();
  expect(page.getByText("Record not published.").elements()).toHaveLength(0);
  expect(page.getByText("Season ends 2027-01-04").elements()).toHaveLength(0);
  expect(page.getByText("Weekly", { exact: true }).elements()).toHaveLength(0);
  expect(page.getByText("Games cap").elements()).toHaveLength(0);
  expect(page.getByText("Categories").elements()).toHaveLength(0);
});

it("shows provider labels for unknown formats, and preserves local controls when facts fail", async () => {
  using _app = setupTeamsPage([baseTeam], {
    cards: () =>
      Promise.resolve([
        {
          ...seasonCard,
          season: {
            ...seasonFacts,
            format: "unknown",
            scoringLabel: "Custom league scoring",
            standing: undefined,
          },
        },
      ]),
  });
  await expect.element(page.getByText("Custom league scoring")).toBeVisible();
  expect(page.getByText("Standings were not published for this team.").elements()).toHaveLength(0);
  expect(page.getByText("Record not published.").elements()).toHaveLength(0);
});

it("keeps rotisserie points without fabricating a season record", async () => {
  using _app = setupTeamsPage([baseTeam], {
    cards: () =>
      Promise.resolve([
        {
          ...seasonCard,
          season: {
            ...seasonFacts,
            format: "rotisserie",
            scoringLabel: "Rotisserie",
            standing: { ...standingFacts, record: undefined, points: 99, pointsFor: 0 },
          },
        },
      ]),
  });
  await expect.element(page.getByText("99 points", { exact: true })).toBeVisible();
  expect(page.getByText("0 points", { exact: true }).elements()).toHaveLength(0);
  expect(page.getByText("This format does not publish a win-loss record.").elements()).toHaveLength(
    0,
  );
  expect(page.getByText("0-0-0").elements()).toHaveLength(0);
});

it("keeps published zero for points for, against and behind without substituting season points", async () => {
  using _app = setupTeamsPage([baseTeam], {
    cards: () =>
      Promise.resolve([
        {
          ...seasonCard,
          season: {
            ...seasonFacts,
            format: "head_to_head_points",
            standing: {
              ...standingFacts,
              points: 99,
              pointsFor: 0,
              pointsAgainst: 0,
              pointsBack: 0,
            },
          },
        },
      ]),
  });
  await expect
    .element(page.getByText("0 points for · 0 against · 0 behind", { exact: true }))
    .toBeVisible();
  expect(page.getByText("99", { exact: true }).elements()).toHaveLength(0);
});

it.each(["head_to_head_categories", "head_to_head_points", "points", "unknown"] as const)(
  "does not substitute total points for missing $0 points for",
  (format) => {
    using _app = setupTeamsPage([baseTeam], {
      cards: () =>
        Promise.resolve([
          {
            ...seasonCard,
            season: {
              ...seasonFacts,
              format,
              standing: { ...standingFacts, points: 99, pointsFor: null },
            },
          },
        ]),
    });
    expect(page.getByText("Points were not published for this team.").elements()).toHaveLength(0);
    expect(page.getByText("99", { exact: true }).elements()).toHaveLength(0);
  },
);

it.each([
  { format: "head_to_head_categories", label: "Categories" },
  { format: "head_to_head_points", label: "Points" },
  { format: "rotisserie", label: "Rotisserie" },
  { format: "points", label: "Points" },
  { format: "unknown", label: undefined },
] as const)(
  "shows a plain $format label when the provider publishes none",
  async ({ format, label }) => {
    using _app = setupTeamsPage([baseTeam], {
      cards: () =>
        Promise.resolve([
          {
            ...seasonCard,
            season: { ...seasonFacts, format, scoringLabel: undefined },
          },
        ]),
    });
    if (label === undefined) {
      expect(page.getByText("Unknown scoring format").elements()).toHaveLength(0);
    } else {
      await expect.element(page.getByText(label, { exact: true }).last()).toBeVisible();
    }
  },
);

it.each(["head_to_head_categories", "head_to_head_points", "points", "unknown"] as const)(
  "shows published $0 records outside rotisserie",
  async (format) => {
    using _app = setupTeamsPage([baseTeam], {
      cards: () =>
        Promise.resolve([
          {
            ...seasonCard,
            season: { ...seasonFacts, format },
          },
        ]),
    });
    await expect.element(page.getByText("7-3-0 (.700)")).toBeVisible();
    expect(
      page.getByText("This format does not publish a win-loss record.").elements(),
    ).toHaveLength(0);
  },
);

it.each(["head_to_head_categories", "head_to_head_points", "points", "unknown"] as const)(
  "explains absent $0 records without inventing a zero record",
  (format) => {
    using _app = setupTeamsPage([baseTeam], {
      cards: () =>
        Promise.resolve([
          {
            ...seasonCard,
            season: { ...seasonFacts, format, standing: { ...standingFacts, record: undefined } },
          },
        ]),
    });
    expect(page.getByText("Record not published.").elements()).toHaveLength(0);
    expect(page.getByText("0-0-0").elements()).toHaveLength(0);
  },
);

it("keeps the season window instead of naming a current week when the season is over", () => {
  using _app = setupTeamsPage([baseTeam], {
    cards: () =>
      Promise.resolve([
        {
          ...seasonCard,
          season: { ...seasonFacts, seasonOver: true },
        },
      ]),
  });
  expect(page.getByText("Season ended 2027-01-04").elements()).toHaveLength(0);
  expect(page.getByText("Week 11 of 18").elements()).toHaveLength(0);
});

it("shows a missing percentage as missing, not as zero", async () => {
  using _app = setupTeamsPage([baseTeam], {
    cards: () =>
      Promise.resolve([
        {
          ...seasonCard,
          season: {
            ...seasonFacts,
            standing: {
              ...standingFacts,
              record: { wins: 7, losses: 3, ties: 0, percentage: null },
            },
          },
        },
      ]),
  });
  await expect.element(page.getByText("7-3-0")).toBeVisible();
  expect(page.getByText("7-3-0 (.000)").elements()).toHaveLength(0);
});

it("keeps local team controls when the batch read fails", async () => {
  using _app = setupTeamsPage(
    [baseTeam],
    { cards: () => Promise.reject(new Error("Offline")) },
    { retryDelay: 0 },
  );
  await expect
    .element(
      page.getByText(
        "Season facts could not be loaded. Lineup runs and controls are still available.",
      ),
    )
    .toBeVisible();
  await expect.element(page.getByRole("switch", { name: "Lineup checks for Alpha" })).toBeVisible();
  await expect.element(page.getByText("Categories", { exact: true })).toBeVisible();
});

it("paints the known card while its season facts load", async () => {
  await page.viewport(390, 844);
  await document.fonts.ready;
  const pending = Promise.withResolvers<ReadonlyArray<TeamCardView>>();
  using _app = setupTeamsPage([baseTeam], { cards: () => pending.promise });
  await expect.element(page.getByText("Next check")).toBeVisible();
  const card = document.querySelector<HTMLElement>("[data-card]");
  expect(card).not.toBeNull();
  expect(page.getByLabelText("Loading teams").elements()).toHaveLength(0);
  expect(card?.querySelectorAll(".animate-pulse").length ?? 0).toBeGreaterThan(0);
  const loadingHeight = card?.getBoundingClientRect().height ?? 0;
  pending.resolve([seasonCardWithMatchup]);
  await expect.element(page.getByText("3rd of 12")).toBeVisible();
  await document.fonts.ready;
  expect(
    Math.abs((card?.getBoundingClientRect().height ?? 0) - loadingHeight),
    `${String(loadingHeight)} -> ${String(card?.getBoundingClientRect().height)}`,
  ).toBeLessThanOrEqual(1);
});

it("paints cached cards while fresh facts are still in flight", async () => {
  await page.viewport(390, 844);
  await document.fonts.ready;
  const pending = Promise.withResolvers<ReadonlyArray<TeamCardView>>();
  using _app = setupTeamsPage(
    [baseTeam],
    { cards: () => pending.promise },
    { seedCards: [seasonCardWithMatchup] },
  );
  await expect.element(page.getByText("3rd of 12")).toBeVisible();
  expect(page.getByLabelText("Loading teams").elements()).toHaveLength(0);
  const card = document.querySelector<HTMLElement>("[data-card]");
  const cachedHeight = card?.getBoundingClientRect().height;
  pending.resolve([seasonCardWithMatchup]);
  await expect.element(page.getByText("Categories")).toBeVisible();
  await document.fonts.ready;
  expect(
    Math.abs((card?.getBoundingClientRect().height ?? 0) - (cachedHeight ?? 0)),
    `${String(cachedHeight)} -> ${String(card?.getBoundingClientRect().height)}`,
  ).toBeLessThanOrEqual(1);
});

it("keeps a long matchup line inside the card's reserved height", async () => {
  await page.viewport(390, 844);
  await document.fonts.ready;
  const cardView: TeamCardView = {
    summary: baseTeam,
    season: {
      ...seasonFacts,
      usesPlayoffs: true,
      playoffStartWeek: 15,
      matchup: {
        week: 9,
        opponent: "Tony’s Terrible Team",
        points: 0,
        opponentPoints: 0,
        projectedPoints: 63.5,
        opponentProjectedPoints: 55,
        remainingGames: 31,
        opponentRemainingGames: 33,
        categories: [],
      },
    },
  };
  const pending = Promise.withResolvers<ReadonlyArray<TeamCardView>>();
  using _app = setupTeamsPage([baseTeam], { cards: () => pending.promise });
  await expect.element(page.getByText("Next check")).toBeVisible();
  const card = document.querySelector<HTMLElement>("[data-card]");
  const loadingHeight = card?.getBoundingClientRect().height ?? 0;
  pending.resolve([cardView]);
  await expect.element(page.getByText(/^Week 9 vs Tony/u)).toBeVisible();
  await document.fonts.ready;
  expect(
    Math.abs((card?.getBoundingClientRect().height ?? 0) - loadingHeight),
    `${String(loadingHeight)} -> ${String(card?.getBoundingClientRect().height)}`,
  ).toBeLessThanOrEqual(1);
});

it.each([
  ["head_to_head_points", "Points"],
  ["points", "Points"],
  ["rotisserie", "Rotisserie"],
] as const)("paints a %s card without a jump when its facts arrive", async (format, label) => {
  await page.viewport(390, 844);
  await document.fonts.ready;
  const team = { ...baseTeam, team: { ...baseTeam.team, scoringFormat: format } };
  const cardView: TeamCardView = {
    summary: baseTeam,
    season: {
      ...seasonFacts,
      format,
      scoringLabel: label,
      ...(format === "rotisserie" ? {} : { usesPlayoffs: true, playoffStartWeek: 15 }),
      ...(format === "rotisserie"
        ? {}
        : {
            matchup: {
              week: 9,
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
    },
  };
  const pending = Promise.withResolvers<ReadonlyArray<TeamCardView>>();
  using _app = setupTeamsPage([team], { cards: () => pending.promise });
  await expect.element(page.getByText("Next check")).toBeVisible();
  await expect.element(page.getByText(label, { exact: true })).toBeVisible();
  const card = document.querySelector<HTMLElement>("[data-card]");
  const loadingHeight = card?.getBoundingClientRect().height ?? 0;
  pending.resolve([cardView]);
  await expect.element(page.getByText("3rd of 12")).toBeVisible();
  await document.fonts.ready;
  expect(
    Math.abs((card?.getBoundingClientRect().height ?? 0) - loadingHeight),
    `${format}: ${String(loadingHeight)} -> ${String(card?.getBoundingClientRect().height)}`,
  ).toBeLessThanOrEqual(1);
});

it("paints the known card at desktop while its season facts load", async () => {
  await page.viewport(1440, 900);
  await document.fonts.ready;
  const pending = Promise.withResolvers<ReadonlyArray<TeamCardView>>();
  using _app = setupTeamsPage([baseTeam], { cards: () => pending.promise });
  await expect.element(page.getByText("Next check")).toBeVisible();
  const card = document.querySelector<HTMLElement>("[data-card]");
  const loadingHeight = card?.getBoundingClientRect().height ?? 0;
  pending.resolve([seasonCardWithMatchup]);
  await expect.element(page.getByText("3rd of 12")).toBeVisible();
  await document.fonts.ready;
  expect(
    Math.abs((card?.getBoundingClientRect().height ?? 0) - loadingHeight),
    `${String(loadingHeight)} -> ${String(card?.getBoundingClientRect().height)}`,
  ).toBeLessThanOrEqual(1);
});

it("explains when a ready connection has no card facts for a local team", async () => {
  using _app = setupTeamsPage([baseTeam]);
  await expect
    .element(page.getByText("Season facts were not published for this team."))
    .toBeVisible();
  await expect.element(page.getByRole("switch", { name: "Lineup checks for Alpha" })).toBeVisible();
});

it("keeps season facts and controls in a phone viewport", async () => {
  await page.viewport(390, 844);
  await document.fonts.ready;
  using _app = setupTeamsPage([baseTeam], { cards: () => Promise.resolve([tallSeasonCard]) });
  await expect.element(page.getByText("3rd of 12")).toBeVisible();
  await document.fonts.ready;
  const card = page
    .getByRole("link", { name: "Alpha", exact: true })
    .element()
    .closest<HTMLElement>("[data-card]");
  const facts = card?.querySelector("[data-card-body]")?.getBoundingClientRect().height ?? 0;
  expect(facts).toBeLessThan(320);
  expect(card?.getBoundingClientRect().height).toBeLessThanOrEqual(550);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    document.documentElement.clientWidth,
  );
});

it("keeps the first card controls in the first phone screen and captures both themes", async () => {
  using _app = setupTeamsPage([baseTeam], { cards: () => Promise.resolve([seasonCard]) });
  await expect.element(page.getByText("Categories")).toBeVisible();
  await document.fonts.ready;
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    await page.viewport(width, height);
    for (const theme of ["light", "dark"] as const) {
      applyTheme(theme);
      const card = page
        .getByRole("link", { name: "Alpha", exact: true })
        .element()
        .closest<HTMLElement>("[data-card]");
      const toggle = page.getByRole("switch", { name: "Lineup checks for Alpha" }).element();
      expect(toggle.getBoundingClientRect().bottom).toBeLessThan(844);
      expect(toggle.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: `../../../../../.artifacts/team-overview-polish/card-full-${width}x${height}-${theme}.png`,
        save: true,
        element: card ?? undefined,
      });
    }
  }
  applyTheme("light");
});

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

  await expect.element(page.getByText("Paused today", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText(`Resumes at ${formatClockTime(pausedTeam.team.automation.resumesAt ?? "")}`, {
        exact: true,
      }),
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
  await expect.element(page.getByText("Paused today", { exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByText(/^\d{1,2}:\d{2}( [ap]m)?$/u)).toBeVisible();
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

  await expect.element(page.getByText("Paused today", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText(`Resumes at ${formatClockTime(pausedTeam.team.automation.resumesAt ?? "")}`, {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Resume lineup checks" })).toBeVisible();
  expect(changes).toEqual([{ team: teamId, action: "pause-today" }]);
});

it("pauses the icon and the check line together before the server answers", async () => {
  const answer = Promise.withResolvers<TeamChangeView>();
  using _app = setupTeamsPage([enabledTeam], { control: () => answer.promise });

  const row = page.getByRole("listitem").filter({ hasText: "Alpha" });
  const toggle = row.getByRole("switch", { name: "Lineup checks for Alpha" });
  await expect.element(row.getByText(/^\d{1,2}:\d{2}( [ap]m)?$/u)).toBeVisible();
  await row
    .getByRole("button", { name: "Pause lineup checks for the rest of the fantasy day" })
    .click();

  await expect.element(row.getByRole("button", { name: "Resume lineup checks" })).toBeVisible();
  await expect.element(row.getByText("Paused today", { exact: true })).toBeVisible();
  await expect.element(row.getByText(/^\d{1,2}:\d{2}( [ap]m)?$/u)).not.toBeInTheDocument();
  await expect.element(toggle).toHaveAttribute("aria-checked", "true");

  answer.resolve({ changed: [pausedTeam], teams: [pausedTeam] });
  await expect.element(row.getByText(/^Resumes at /u)).toBeVisible();
});

it("restores the icon and the check line when a pause fails", async () => {
  const answer = Promise.withResolvers<TeamChangeView>();
  using _app = setupTeamsPage([enabledTeam], { control: () => answer.promise });

  const row = page.getByRole("listitem").filter({ hasText: "Alpha" });
  await row
    .getByRole("button", { name: "Pause lineup checks for the rest of the fantasy day" })
    .click();
  await expect.element(row.getByRole("button", { name: "Resume lineup checks" })).toBeVisible();
  await expect.element(row.getByText("Paused today", { exact: true })).toBeVisible();

  answer.reject(new Error("Network"));

  await expect
    .element(
      row.getByRole("button", { name: "Pause lineup checks for the rest of the fantasy day" }),
    )
    .toBeVisible();
  await expect.element(row.getByText(/^\d{1,2}:\d{2}( [ap]m)?$/u)).toBeVisible();
  await expect
    .element(
      page.getByText(
        "We could not confirm the change, so the control returned to the last known state. Check the latest list before trying again.",
      ),
    )
    .toBeVisible();
});

it("shows a working refresh on the control and the list", async () => {
  const answer = Promise.withResolvers<TeamRefreshView>();
  using _app = setupTeamsPage([enabledTeam], { refresh: () => answer.promise });

  const refresh = page.getByRole("button", { name: "Refresh teams" });
  const toggle = page.getByRole("switch", { name: "Lineup checks for Alpha" });
  await expect.element(page.getByRole("listitem").filter({ hasText: "Alpha" })).toBeVisible();
  const list = page.getByRole("listitem").filter({ hasText: "Alpha" }).element().parentElement;

  await refresh.click();

  await expect.element(refresh).toHaveAttribute("data-state", "working");
  await expect.element(refresh).toHaveAttribute("aria-busy", "true");
  expect(list?.getAttribute("data-state")).toBe("working");
  expect(list?.getAttribute("aria-busy")).toBe("true");
  await expect.element(toggle).toBeDisabled();

  answer.resolve({ teams: [enabledTeam] });

  await expect.element(refresh).toHaveAttribute("data-state", "done");
  expect(list?.getAttribute("aria-busy")).toBeNull();
  await expect.element(toggle).not.toBeDisabled();
});

it("keeps one pending action on a team when the controls are pressed together", async () => {
  const answer = Promise.withResolvers<TeamChangeView>();
  const changes: Array<{ readonly team: string; readonly action: string }> = [];
  const refreshes: Array<void> = [];
  using _app = setupTeamsPage([enabledTeam], {
    control: (input) => {
      changes.push(input);
      return answer.promise;
    },
    refresh: () => {
      refreshes.push(undefined);
      return Promise.resolve({ teams: [enabledTeam] });
    },
  });

  const row = page.getByRole("listitem").filter({ hasText: "Alpha" });
  const toggle = row.getByRole("switch", { name: "Lineup checks for Alpha" });
  const refresh = page.getByRole("button", { name: "Refresh teams" });

  await row
    .getByRole("button", { name: "Pause lineup checks for the rest of the fantasy day" })
    .click();
  const resume = row.getByRole("button", { name: "Resume lineup checks" });
  await expect.element(resume).toHaveAttribute("data-state", "working");
  await expect.element(toggle).toBeDisabled();
  await expect.element(toggle).not.toHaveAttribute("aria-busy");
  await expect.element(refresh).toHaveAttribute("aria-disabled", "true");

  const toggleElement = toggle.element();
  if (toggleElement instanceof HTMLButtonElement) {
    toggleElement.click();
  }
  const refreshElement = refresh.element();
  if (refreshElement instanceof HTMLButtonElement) {
    refreshElement.click();
  }

  expect(changes).toEqual([{ team: teamId, action: "pause-today" }]);
  expect(refreshes).toHaveLength(0);
  await expect.element(resume).toHaveAttribute("data-state", "working");

  answer.resolve({ changed: [pausedTeam], teams: [pausedTeam] });

  await expect.element(toggle).not.toBeDisabled();
  await expect.element(refresh).not.toHaveAttribute("aria-disabled");
  await expect.element(resume).not.toHaveAttribute("aria-busy");
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

  await expect.element(page.getByRole("link", { name: "Reconnect" })).toBeVisible();
  await expect
    .element(page.getByText(/needs a new sign-in before lineup checks can run/u))
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
  await expect.element(page.getByText("Changed nothing", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText(formatReaderTime(twoHoursAgo), { exact: true }))
    .toBeVisible();
  await expect.element(page.getByText("Available")).not.toBeInTheDocument();
  await expect.element(page.getByText("Connected")).not.toBeInTheDocument();
  await expect.element(page.getByText("Lineup checks on")).not.toBeInTheDocument();
  await expect.element(page.getByText("Reconnect")).not.toBeInTheDocument();
  await expect.element(page.getByRole("link", { name: /^Open /u })).not.toBeInTheDocument();
});

it("frames a team card with the shared card structure", async () => {
  using _app = setupTeamsPage([enabledTeam]);

  const name = page.getByRole("link", { name: "Alpha", exact: true });
  await expect.element(name).toBeVisible();
  const card = name.element().closest<HTMLElement>("[data-card]");
  expect(card, "a team card uses the shared frame").not.toBeNull();
  if (card === null) {
    return;
  }

  expect(getComputedStyle(card).borderTopWidth).toBe("2px");
  expect(getComputedStyle(card).boxShadow).toBe("none");
  const list = card.parentElement;
  expect(list, "the team card list").not.toBeNull();
  expect(Number.parseFloat(getComputedStyle(list ?? card).rowGap)).toBeGreaterThanOrEqual(24);
  for (const part of ["header", "meta", "body", "footer"]) {
    expect(card.querySelector(`[data-card-${part}]`), `the ${part} slot`).not.toBeNull();
  }
  expect(card.querySelector("[data-card-badge]")).not.toBeNull();
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

it("names the provider only when the account has more than one provider type", async () => {
  const secondTeam: TeamSummaryView = {
    ...baseTeam,
    team: {
      ...baseTeam.team,
      id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a9",
      connectionId: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a8",
      provider: "espn",
      name: "Beta",
      providerTeamKey: "461.l.1000.t.2",
    },
  };
  using _app = setupTeamsPage([baseTeam, secondTeam]);

  await expect.element(page.getByText("Football · NFL 2026 · espn")).toBeVisible();
});

it("keeps the provider out when every team uses the same provider", () => {
  using _app = setupTeamsPage([{ ...enabledTeam, connectionCount: 2 }]);

  expect(page.getByText(/Yahoo/u).elements()).toHaveLength(0);
});

it("keeps a team row in the order of name, league, next check, and last check", async () => {
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
  const next = row.getByText("Next check", { exact: true });
  const last = row.getByText("Last check", { exact: true });
  const lastTime = row.getByText(formatReaderTime(twoHoursAgo), { exact: true });
  const lastNote = row.getByText("Changed 2 players", { exact: true });

  await expect.element(name).toBeVisible();
  expect(name.element().className).toContain("text-card-title");
  await expect.element(league).toBeVisible();
  await expect.element(next).toBeVisible();
  await expect.element(last).toBeVisible();
  await expect.element(lastTime).toBeVisible();
  await expect.element(lastNote).toBeVisible();

  for (const later of [league, next, last, lastTime, lastNote]) {
    expect(
      name.element().compareDocumentPosition(later.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
  for (const later of [next, last, lastTime, lastNote]) {
    expect(
      league.element().compareDocumentPosition(later.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
  expect(
    next.element().compareDocumentPosition(last.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
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
    const measured = EffectArray.filter(heights, (entry) => entry.width === width);
    expect(measured, `${width}px measures every state`).toHaveLength(4);
    expect(
      new Set(EffectArray.map(measured, (entry) => entry.height)).size,
      `${width}px keeps one row height across ${EffectArray.join(
        EffectArray.map(measured, (entry) => entry.state),
        ", ",
      )}`,
    ).toBe(1);
  }
});

it("sorts team cards by sport then name across leagues", async () => {
  const named = (
    name: string,
    sport: TeamSummaryView["team"]["sport"],
    league: TeamSummaryView["team"]["league"],
  ): TeamSummaryView => ({
    ...enabledTeam,
    team: {
      ...enabledTeam.team,
      id: crypto.randomUUID(),
      league,
      name,
      sport,
    },
  });
  using _app = setupTeamsPage([
    named("Zulu Hockey", "hockey", "nhl"),
    named("Bravo Football", "football", "nfl"),
    named("Alpha Football", "football", "nfl"),
    named("Charlie Baseball", "baseball", "mlb"),
  ]);

  await expect
    .element(page.getByRole("link", { name: "Alpha Football", exact: true }))
    .toBeVisible();
  const names = EffectArray.map(
    page.getByRole("listitem").elements(),
    (row) => row.querySelector("a")?.textContent,
  );
  expect(names).toEqual(["Charlie Baseball", "Alpha Football", "Bravo Football", "Zulu Hockey"]);
  await expect.element(page.getByRole("heading", { name: "NFL" })).not.toBeInTheDocument();
  await expect.element(page.getByRole("heading", { name: "Your teams" })).toBeVisible();
});

it("says the next check, the pause, checks off, or a check in flight", async () => {
  const mounted = setupTeamsPage([enabledTeam]);
  try {
    await expect.element(page.getByText(/^\d{1,2}:\d{2}( [ap]m)?$/u)).toBeVisible();
    await expect.element(page.getByText("Scheduled hourly.", { exact: true })).toBeVisible();
  } finally {
    mounted[Symbol.dispose]();
  }

  const paused = setupTeamsPage([pausedTeam]);
  try {
    await expect.element(page.getByText("Paused today", { exact: true })).toBeVisible();
    await expect
      .element(
        page.getByText(
          `Resumes at ${formatClockTime(pausedTeam.team.automation.resumesAt ?? "")}`,
          { exact: true },
        ),
      )
      .toBeVisible();
  } finally {
    paused[Symbol.dispose]();
  }

  const off = setupTeamsPage([baseTeam]);
  try {
    await expect.element(page.getByText("Checks are off", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Turn them on to check hourly.", { exact: true }))
      .toBeVisible();
  } finally {
    off[Symbol.dispose]();
  }

  const inFlight = setupTeamsPage([
    { ...enabledTeam, lastRun: checkingRun, recentRuns: [checkingRun] },
  ]);
  try {
    await expect.element(page.getByText("Checking now", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Usually under a minute.", { exact: true })).toBeVisible();
  } finally {
    inFlight[Symbol.dispose]();
  }

  const waiting = setupTeamsPage([{ ...enabledTeam, lastRun: queuedRun, recentRuns: [queuedRun] }]);
  try {
    await expect.element(page.getByText("Waiting to start", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Queued for the next check.", { exact: true }))
      .toBeVisible();
  } finally {
    waiting[Symbol.dispose]();
  }
});

it("says what the last check did without a tally", async () => {
  using _app = setupTeamsPage([
    { ...enabledTeam, lastRun: changedRun, recentRuns: [changedRun, noOpRun, noOpRun] },
  ]);

  await expect
    .element(page.getByText(formatReaderTime(twoHoursAgo), { exact: true }))
    .toBeVisible();
  await expect.element(page.getByText("Changed 2 players", { exact: true })).toBeVisible();
  expect(page.getByText(/checks changed the lineup/u).elements()).toHaveLength(0);
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

it("starts card facts without waiting for the team list", async () => {
  const pendingList = Promise.withResolvers<ReadonlyArray<TeamSummaryView>>();
  let cardReads = 0;
  using _app = setupTeamsPage([], {
    list: () => pendingList.promise,
    cards: () => {
      cardReads += 1;
      return Promise.resolve([seasonCard]);
    },
  });

  await expect.element(page.getByLabelText("Loading teams")).toBeVisible();
  expect(cardReads).toBe(1);
  pendingList.resolve([baseTeam]);
  await expect.element(page.getByText("3rd of 12")).toBeVisible();
  expect(cardReads).toBe(1);
});

it("shows one loading mark while the team list is pending", async () => {
  const pending = Promise.withResolvers<ReadonlyArray<TeamSummaryView>>();
  using _app = setupTeamsPage([], { list: () => pending.promise });

  const loading = page.getByLabelText("Loading teams");
  await expect.element(loading).toBeVisible();
  expect(loading.getByRole("listitem").elements()).toHaveLength(0);
  pending.resolve([enabledTeam]);
  await expect.element(page.getByRole("link", { name: "Alpha", exact: true })).toBeVisible();
  expect(loading.elements()).toHaveLength(0);
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
  overrides: Partial<Pick<TeamRemote, "list" | "refresh" | "control" | "cards">> = {},
  queryOptions: {
    readonly retryDelay?: number;
    readonly seedCards?: ReadonlyArray<TeamCardView>;
  } = {},
): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  if (queryOptions.retryDelay !== undefined) {
    queryClient.setDefaultOptions({ queries: { retryDelay: queryOptions.retryDelay } });
  }
  if (queryOptions.seedCards !== undefined) {
    queryClient.setQueryData(teamQueries.cardsKey, queryOptions.seedCards, { updatedAt: 0 });
  }
  const remote: TeamRemote = {
    list: overrides.list ?? (() => Promise.resolve(teams)),
    cards: overrides.cards ?? (() => Promise.resolve([])),
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
