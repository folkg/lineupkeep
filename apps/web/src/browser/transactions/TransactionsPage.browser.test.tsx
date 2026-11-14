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
import { TransactionsNavContext } from "#browser/app-shell/transactionsNav.ts";
import { createQueryClient } from "#browser/query/queryClient.ts";
import type { SessionRemote } from "#browser/session/sessionRemote.ts";
import { formatCalendarDate } from "#browser/shared-ui/formatTime.ts";
import type {
  DismissTransactionProposalData,
  DismissTransactionProposalRequest,
  RescheduleTransactionProposalData,
  RescheduleTransactionProposalRequest,
  SubmitTransactionReviewRequest,
  TransactionProposalItemView,
  TransactionProposalListData,
  TransactionProposalSetSummaryView,
  TransactionReviewPlayerView,
  TransactionReviewView,
  TransactionRunGroupView,
} from "#contracts/connections/transactionContract.ts";

import { transactionQueries } from "./transactionQueries.ts";
import type { TransactionRemote } from "./transactionRemote.ts";
import { TransactionsNavLink } from "./TransactionsNavLink.tsx";
import { TransactionsPage } from "./TransactionsPage.tsx";

const footballTeam = {
  id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1",
  name: "Alpha",
  league: "nfl" as const,
  sport: "football" as const,
  season: 2026,
};
const hockeyTeam = {
  id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a2",
  name: "Beta",
  league: "nhl" as const,
  sport: "hockey" as const,
  season: 2026,
};
const openPlanId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165b1";
const futurePlanId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165b2";
const endedPlanId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165b3";
const today = "2026-11-13";
const now = new Date().toISOString();

it("renders today, future days, the earlier count, and the top bar count", async () => {
  const todayItem = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c1",
    drops: [player("Riley Chen", "D", "TOR")],
  });
  const futureItem = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c2",
    kind: "free_agent_add",
    adds: [player("Jordan Lee", "WR", "SEA")],
    drops: [],
    window: "2026-11-15",
    effectiveDate: "2026-11-16",
    lifecycle: "scheduled",
    reason: "Add a receiver before the next run.",
  });
  const endedItem = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c3",
    drops: [player("Owen Park", "D", "TOR")],
    state: "executed",
    lifecycle: "executed",
    settled: true,
    execution: { outcome: "executed", decidedAt: now, steps: [] },
  });
  using _app = setupTransactionsPage({
    open: listData(
      [
        plan({
          id: openPlanId,
          teams: [teamEntry(footballTeam, [todayItem], [day(todayItem.id, today, "same_day")])],
        }),
        plan({
          id: futurePlanId,
          teams: [
            teamEntry(hockeyTeam, [futureItem], [day(futureItem.id, "2026-11-15", "next_day")]),
          ],
        }),
      ],
      { open: 2, ended: 1 },
    ),
    closed: listData([
      plan({
        id: endedPlanId,
        closed: true,
        teams: [teamEntry(footballTeam, [endedItem], undefined)],
      }),
    ]),
  });

  await expect.element(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Upcoming" })).toBeVisible();
  await expect.element(page.getByText("Drop Riley Chen", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Add Jordan Lee", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByRole("heading", {
        name: formatCalendarDate("2026-11-15"),
      }),
    )
    .toBeVisible();
  await expect
    .element(page.getByText(new RegExp(`Runs ${formatCalendarDate("2026-11-15")} at 12:00 am`)))
    .toBeVisible();
  await expect
    .element(page.getByText(`Takes effect ${formatCalendarDate("2026-11-16")}.`, { exact: true }))
    .toBeVisible();
  await expect
    .element(
      page.getByRole("link", {
        name: /Transactions 2 open moves/,
      }),
    )
    .toBeVisible();

  await expect.element(page.getByText("1 ended move", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByText("Executed", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Drop Owen Park", { exact: true })).toBeVisible();
});

it("submits only today's moves and leaves the saved move alone", async () => {
  const todayItem = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c4",
    drops: [player("Riley Chen", "D", "TOR")],
  });
  const futureItem = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c5",
    drops: [player("Owen Park", "D", "TOR")],
    window: "2026-11-15",
    lifecycle: "scheduled",
  });
  const data = listData([
    plan({
      id: openPlanId,
      teams: [
        teamEntry(
          footballTeam,
          [todayItem, futureItem],
          [day(todayItem.id, today, "same_day"), day(futureItem.id, "2026-11-15", "same_day")],
        ),
      ],
    }),
  ]);
  const requests: Array<SubmitTransactionReviewRequest> = [];
  using _app = setupTransactionsPage({
    open: data,
    closed: listData([]),
    submit: (input) => {
      requests.push(input);
      return Promise.resolve({
        review: review(input.set),
        scheduled: 0,
        detail: "Submitted 1 move today.",
      });
    },
  });

  await page.getByRole("button", { name: /Submit now: Drop Riley Chen/ }).click();

  await expect.element(page.getByText("Submitted 1 move today.", { exact: true })).toBeVisible();
  expect(requests).toStrictEqual([{ set: openPlanId, include: [todayItem.id], bids: [] }]);
  await expect.element(page.getByText("Drop Owen Park", { exact: true })).toBeVisible();
});

it("edits and discards a future move without losing its controls", async () => {
  const futureItem = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c6",
    drops: [player("Riley Chen", "D", "TOR")],
    window: "2026-11-15",
    lifecycle: "scheduled",
  });
  const data = listData([
    plan({
      id: futurePlanId,
      teams: [
        teamEntry(footballTeam, [futureItem], [day(futureItem.id, "2026-11-15", "next_day")]),
      ],
    }),
  ]);
  const rescheduled: Array<RescheduleTransactionProposalRequest> = [];
  const dismissed: Array<DismissTransactionProposalRequest> = [];
  using _app = setupTransactionsPage({
    open: data,
    closed: listData([]),
    reschedule: (input) => {
      rescheduled.push(input);
      return Promise.resolve({
        status: "saved",
        set: futurePlanId,
        window: input.window,
        saved: 1,
        refused: [],
      } satisfies RescheduleTransactionProposalData);
    },
    dismiss: (input) => {
      dismissed.push(input);
      return Promise.resolve({
        outcome: "dismissed",
        review: review(input.set),
      } satisfies DismissTransactionProposalData);
    },
  });

  const edit = page.getByRole("button", { name: /Edit: Drop Riley Chen/ });
  const discard = page.getByRole("button", { name: /Discard: Drop Riley Chen/ });
  await expect.element(edit).toBeVisible();
  await expect.element(edit).not.toHaveAttribute("aria-disabled");
  await expect.element(discard).toBeVisible();
  await expect.element(discard).not.toHaveAttribute("aria-disabled");

  await edit.click();
  await expect
    .element(page.getByText(/Saving withdraws this saved move and proposes a replacement/u))
    .toBeVisible();
  const date = page.getByLabelText("Run date");
  await expect.element(date).toHaveValue("2026-11-15");
  await date.fill("2026-11-17");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect
    .element(
      page.getByText(`Saved 1 move for ${formatCalendarDate("2026-11-17")}.`, { exact: true }),
    )
    .toBeVisible();
  expect(rescheduled).toStrictEqual([
    { set: futurePlanId, items: [futureItem.id], window: "2026-11-17" },
  ]);
  await expect.element(page.getByRole("button", { name: /Edit: Drop Riley Chen/ })).toBeVisible();

  await page.getByRole("button", { name: /Discard: Drop Riley Chen/ }).click();
  await expect.element(page.getByText("Discarded 1 move.", { exact: true })).toBeVisible();
  expect(dismissed).toStrictEqual([{ set: futurePlanId, items: [futureItem.id] }]);
  await expect.element(page.getByRole("button", { name: /Edit: Drop Riley Chen/ })).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: /Discard: Drop Riley Chen/ }))
    .toBeVisible();
});

it("keeps a multi move proposal under one team heading and one edit control", async () => {
  const add = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c7",
    kind: "free_agent_add",
    adds: [player("Jordan Lee", "WR", "SEA")],
    drops: [],
    window: "2026-11-15",
    lifecycle: "scheduled",
    reason: "Add a receiver.",
  });
  const drop = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c8",
    drops: [player("Riley Chen", "D", "TOR")],
    window: "2026-11-15",
    lifecycle: "scheduled",
    reason: "Open the place.",
  });
  using _app = setupTransactionsPage({
    open: listData([
      plan({
        id: futurePlanId,
        teams: [
          teamEntry(
            footballTeam,
            [add, drop],
            [day(add.id, "2026-11-15", "next_day", [add.id, drop.id])],
          ),
        ],
      }),
    ]),
    closed: listData([]),
  });

  await expect.element(page.getByRole("heading", { name: "Alpha" })).toBeVisible();
  expect(page.getByRole("heading", { name: "Alpha" }).elements()).toHaveLength(1);
  await expect.element(page.getByText("Add Jordan Lee", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Drop Riley Chen", { exact: true })).toBeVisible();
  expect(
    page.getByRole("button", { name: /Edit: Add Jordan Lee, Drop Riley Chen/ }).elements(),
  ).toHaveLength(1);
});

it("keeps the timeline inside a phone viewport and shows the phone submit line", async () => {
  const first = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c9",
    drops: [player("Riley Chen", "D", "TOR")],
  });
  const second = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d0",
    drops: [player("Owen Park", "D", "TOR")],
  });
  await page.viewport(390, 844);
  try {
    using _app = setupTransactionsPage({
      open: listData([
        plan({
          id: openPlanId,
          teams: [teamEntry(footballTeam, [first], [day(first.id, today, "same_day")])],
        }),
        plan({
          id: futurePlanId,
          teams: [teamEntry(hockeyTeam, [second], [day(second.id, today, "same_day")])],
        }),
      ]),
      closed: listData([]),
    });

    await expect.element(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect.element(page.getByText("2 moves today", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Submit today" })).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: /Transactions 2 open moves/ }))
      .toBeVisible();
    const root = document.documentElement;
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);

    await page.viewport(1440, 900);
    await expect
      .element(page.getByRole("button", { name: "Submit all of today's moves" }))
      .toBeVisible();
  } finally {
    await page.viewport(1280, 720);
  }
});

function setupTransactionsPage(
  options: { readonly open: TransactionProposalListData } & {
    readonly closed: TransactionProposalListData;
    readonly submit?: TransactionRemote["submit"];
    readonly dismiss?: TransactionRemote["dismiss"];
    readonly reschedule?: TransactionRemote["reschedule"];
  },
): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const remote: TransactionRemote = {
    read: () => Promise.reject(new Error("Unexpected review read")),
    list: (input) => Promise.resolve(input.state === "closed" ? options.closed : options.open),
    submit: options.submit ?? (() => Promise.reject(new Error("Unexpected submission"))),
    dismiss:
      options.dismiss ??
      ((input) => Promise.resolve({ outcome: "dismissed", review: review(input.set) })),
    withdraw: () => Promise.reject(new Error("Unexpected trade withdrawal")),
    reschedule: options.reschedule ?? (() => Promise.reject(new Error("Unexpected reschedule"))),
  };
  const openQuery = transactionQueries.list(remote, { state: "open" });
  queryClient.setQueryData(openQuery.queryKey, {
    pages: [options.open],
    pageParams: [undefined],
  });
  const closedQuery = transactionQueries.list(remote, { state: "closed" });
  queryClient.setQueryData(closedQuery.queryKey, {
    pages: [options.closed],
    pageParams: [undefined],
  });
  const sessionRemote: SessionRemote = {
    load: () => Promise.resolve({ status: "authenticated", userId: "reader" }),
    signOut: () => Promise.resolve(),
  };
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <TransactionsNavContext value={{ render: () => <TransactionsNavLink remote={remote} /> }}>
          <Outlet />
        </TransactionsNavContext>
      </QueryClientProvider>
    ),
  });
  const transactionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/transactions",
    component: () => <TransactionsPage remote={remote} />,
  });
  const reviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/transactions/$setId",
    component: () => <p>Review</p>,
  });
  const teamRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/teams/$teamId",
    component: () => <p>Team</p>,
  });
  const teamsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/teams",
    component: () => <p>Teams</p>,
  });
  const accountRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/account",
    component: () => <p>Account</p>,
  });
  const router = createRouter({
    context: { queryClient, sessionRemote },
    history: createMemoryHistory({ initialEntries: ["/transactions"] }),
    routeTree: rootRoute.addChildren([
      transactionsRoute,
      reviewRoute,
      teamRoute,
      teamsRoute,
      accountRoute,
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

function plan(
  overrides: Partial<TransactionProposalSetSummaryView> & {
    readonly teams: ReadonlyArray<TransactionProposalSetSummaryView["teams"][number]>;
  },
): TransactionProposalSetSummaryView {
  const id = overrides.id ?? openPlanId;
  return {
    id,
    proposedBy: { kind: "agent", surface: "mcp", client: "Draft Desk" },
    createdAt: now,
    updatedAt: now,
    closed: false,
    reviewPath: `/transactions/${id}`,
    ...overrides,
  };
}

function teamEntry(
  team: TransactionProposalSetSummaryView["teams"][number]["team"],
  items: ReadonlyArray<TransactionProposalItemView>,
  groups: ReadonlyArray<TransactionRunGroupView> | undefined,
): TransactionProposalSetSummaryView["teams"][number] {
  return {
    team,
    today,
    items,
    ...(groups === undefined ? {} : { groups }),
  };
}

function day(
  first: string,
  date: string,
  effectiveRule: TransactionRunGroupView["effectiveRule"],
  items: ReadonlyArray<string> = [first],
): TransactionRunGroupView {
  return {
    date,
    triggerAt: `${date}T08:00:00.000Z`,
    timeZone: "America/Los_Angeles",
    effectiveRule,
    items,
  };
}

function item(overrides: Partial<TransactionProposalItemView> = {}): TransactionProposalItemView {
  const state = overrides.state ?? "proposed";
  const lifecycle =
    overrides.lifecycle ??
    (state === "proposed"
      ? overrides.staleness !== undefined && overrides.staleness.status !== "current"
        ? "stale"
        : "proposed"
      : state);
  return {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d1",
    kind: "drop",
    adds: [],
    drops: [player("Riley Chen", "D", "TOR")],
    picks: [],
    reason: "Drop the open roster place.",
    state,
    lifecycle,
    budgetPeriod: {
      status: "none",
      detail: "Only a waiver claim with a FAAB bid spends a budget.",
    },
    settled: false,
    staleness: { status: "current", checkedAt: now, reasons: [] },
    ...overrides,
  };
}

function listData(
  sets: ReadonlyArray<TransactionProposalSetSummaryView>,
  counts?: TransactionProposalListData["counts"],
): TransactionProposalListData {
  const items = sets.flatMap((set) => set.teams.flatMap((entry) => entry.items));
  const open = items.filter((entry) => entry.state === "proposed" && !entry.settled).length;
  return {
    status: "ok",
    sets,
    counts: counts ?? { open, ended: items.length - open },
    page: {
      returned: sets.length,
      complete: true,
      remaining: 0,
      total: sets.length,
    },
  };
}

function review(set: string): TransactionReviewView {
  return {
    set: {
      id: set,
      proposedBy: { kind: "agent", surface: "mcp" },
      createdAt: now,
      updatedAt: now,
      submissions: [],
      closed: false,
    },
    teams: [],
  };
}

function player(
  name: string,
  position: string,
  proTeam: string,
  availability?: string,
): TransactionReviewPlayerView {
  return {
    name,
    position,
    proTeam,
    ...(availability === undefined ? {} : { availability }),
  };
}
