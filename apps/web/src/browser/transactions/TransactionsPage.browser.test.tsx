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

it("renders day and team groups, counts, scheduled timing, and earlier moves", async () => {
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
  await expect.element(page.getByText("2 open moves", { exact: true })).toBeVisible();
  await expect.element(page.getByText("1 today · 1 scheduled", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Scheduled" })).toBeVisible();
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
  await expect.element(page.getByRole("region", { name: "Alpha" })).toBeVisible();
  await expect.element(page.getByRole("region", { name: "Beta" })).toBeVisible();

  await expect.element(page.getByText("1 ended move", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByText("Executed", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Drop Owen Park", { exact: true })).toBeVisible();
});

it("shows why a stale move cannot run and disables its choice", async () => {
  const stale = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d4",
    drops: [player("Riley Chen", "D", "TOR")],
    staleness: {
      status: "stale",
      checkedAt: now,
      reasons: [
        {
          code: "drop_not_rostered",
          detail: "Riley Chen is no longer on this team's roster, so there is nothing to drop.",
        },
      ],
    },
  });
  using _app = setupTransactionsPage({
    open: listData([
      plan({
        id: openPlanId,
        teams: [teamEntry(footballTeam, [stale], [day(stale.id, today, "same_day")])],
      }),
    ]),
    closed: listData([]),
  });

  await expect.element(page.getByText("Drop Riley Chen", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText(
        "Riley Chen is no longer on this team's roster, so there is nothing to drop.",
        {
          exact: true,
        },
      ),
    )
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: /Do it now: Drop Riley Chen/u }))
    .toBeDisabled();
  await expect
    .element(
      page.getByText("This move needs another look before it can run. You can discard it here.", {
        exact: true,
      }),
    )
    .toBeVisible();
});

it("requires a choice for every today move and submits only the chosen moves", async () => {
  await page.viewport(1280, 720);
  const chosen = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c4",
    drops: [player("Riley Chen", "D", "TOR")],
  });
  const discarded = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c5",
    kind: "free_agent_add",
    adds: [player("Jordan Lee", "WR", "SEA")],
    drops: [],
    reason: "Add a receiver now.",
  });
  const submitted: Array<SubmitTransactionReviewRequest> = [];
  const dismissed: Array<DismissTransactionProposalRequest> = [];
  using _app = setupTransactionsPage({
    open: listData([
      plan({
        id: openPlanId,
        teams: [
          teamEntry(
            footballTeam,
            [chosen, discarded],
            [day(chosen.id, today, "same_day", [chosen.id, discarded.id])],
          ),
        ],
      }),
    ]),
    closed: listData([]),
    submit: (input) => {
      submitted.push(input);
      return Promise.resolve({
        review: review(input.set),
        scheduled: 0,
        detail: "Submitted 1 move today.",
      });
    },
    dismiss: (input) => {
      dismissed.push(input);
      return Promise.resolve({
        outcome: "dismissed",
        review: review(input.set),
      } satisfies DismissTransactionProposalData);
    },
  });

  const submitButton = page.getByRole("button", { name: "Submit today's chosen moves" });
  await expect.element(submitButton).toBeDisabled();
  await expect.element(page.getByText("Not chosen yet.", { exact: true }).first()).toBeVisible();
  await expect
    .element(page.getByText(/2 moves still need a choice\. Choose Do it now or Discard/u))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: /Do it now: Drop Riley Chen/u }))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: /Discard: Add Jordan Lee/u }))
    .toBeVisible();

  await page.getByRole("button", { name: /Do it now: Drop Riley Chen/u }).click();
  await expect.element(submitButton).toBeDisabled();
  await expect
    .element(page.getByText(/1 move still needs a choice\. Choose Do it now or Discard/u))
    .toBeVisible();
  await expect.element(page.getByText("Runs when you submit.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Discard: Add Jordan Lee/u }).click();
  await expect.element(submitButton).toBeEnabled();
  await expect
    .element(page.getByText("Every move today has a choice.", { exact: true }))
    .toBeVisible();
  await expect.element(page.getByText("Discarded when you submit.", { exact: true })).toBeVisible();

  await submitButton.click();

  await expect
    .element(page.getByText("Submitted 1 move today. Discarded 1 move.", { exact: true }))
    .toBeVisible();
  expect(submitted).toStrictEqual([{ set: openPlanId, include: [chosen.id], bids: [] }]);
  expect(dismissed).toStrictEqual([{ set: openPlanId, items: [discarded.id] }]);
});

it("edits and discards one future move at a time", async () => {
  const first = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c6",
    drops: [player("Riley Chen", "D", "TOR")],
    window: "2026-11-15",
    lifecycle: "scheduled",
  });
  const second = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c7",
    kind: "free_agent_add",
    adds: [player("Jordan Lee", "WR", "SEA")],
    drops: [],
    window: "2026-11-15",
    lifecycle: "scheduled",
  });
  const rescheduled: Array<RescheduleTransactionProposalRequest> = [];
  const dismissed: Array<DismissTransactionProposalRequest> = [];
  using _app = setupTransactionsPage({
    open: listData([
      plan({
        id: futurePlanId,
        teams: [
          teamEntry(
            footballTeam,
            [first, second],
            [day(first.id, "2026-11-15", "next_day", [first.id, second.id])],
          ),
        ],
      }),
    ]),
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

  await expect.element(page.getByRole("region", { name: "Alpha" })).toBeVisible();
  expect(page.getByRole("button", { name: /Change date:/u }).elements()).toHaveLength(2);
  expect(page.getByRole("button", { name: /Discard:/u }).elements()).toHaveLength(2);
  await expect
    .element(
      page.getByText(`Saved for ${formatCalendarDate("2026-11-15")}. Editable until then.`).first(),
    )
    .toBeVisible();

  const edit = page.getByRole("button", { name: /Change date: Drop Riley Chen/u });
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
    { set: futurePlanId, items: [first.id], window: "2026-11-17" },
  ]);
  await expect
    .element(page.getByRole("button", { name: /Change date: Drop Riley Chen/u }))
    .toBeVisible();
  expect(page.getByLabelText("Run date").elements()).toHaveLength(0);

  await page.getByRole("button", { name: /Discard: Add Jordan Lee/u }).click();
  await expect.element(page.getByText("Discarded 1 move.", { exact: true })).toBeVisible();
  expect(dismissed).toStrictEqual([{ set: futurePlanId, items: [second.id] }]);
  await expect
    .element(page.getByRole("button", { name: /Change date: Drop Riley Chen/u }))
    .toBeVisible();
});

it("groups the page by day first, then by one card per team, across plans", async () => {
  await page.viewport(1280, 900);
  const firstAlpha = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c8",
    drops: [player("Riley Chen", "D", "TOR")],
  });
  const secondAlpha = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c9",
    kind: "free_agent_add",
    adds: [player("Jordan Lee", "WR", "SEA")],
    drops: [],
    reason: "Add a receiver now.",
  });
  const firstBeta = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d0",
    drops: [player("Owen Park", "D", "TOR")],
    window: "2026-11-15",
    lifecycle: "scheduled",
  });
  const secondBeta = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d1",
    kind: "free_agent_add",
    adds: [player("Sam Rivers", "C", "SEA")],
    drops: [],
    window: "2026-11-15",
    lifecycle: "scheduled",
  });
  using _app = setupTransactionsPage({
    open: listData([
      plan({
        id: openPlanId,
        teams: [teamEntry(footballTeam, [firstAlpha], [day(firstAlpha.id, today, "same_day")])],
      }),
      plan({
        id: futurePlanId,
        teams: [teamEntry(hockeyTeam, [firstBeta], [day(firstBeta.id, "2026-11-15", "next_day")])],
      }),
      plan({
        id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b4",
        teams: [teamEntry(footballTeam, [secondAlpha], [day(secondAlpha.id, today, "same_day")])],
      }),
      plan({
        id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b5",
        teams: [
          teamEntry(hockeyTeam, [secondBeta], [day(secondBeta.id, "2026-11-15", "next_day")]),
        ],
      }),
    ]),
    closed: listData([]),
  });

  await expect.element(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
  const headings = page
    .getByRole("heading")
    .elements()
    .map((element) => element.textContent);
  expect(headings).toStrictEqual([
    "Transactions",
    "Today",
    "Alpha",
    "Scheduled",
    formatCalendarDate("2026-11-15"),
    "Beta",
    "Earlier",
  ]);
  await expect.element(page.getByText("4 open moves", { exact: true })).toBeVisible();
  await expect.element(page.getByText("2 today · 2 scheduled", { exact: true })).toBeVisible();
  const alpha = page.getByRole("region", { name: "Alpha" });
  await expect.element(alpha.getByText("Drop Riley Chen", { exact: true })).toBeVisible();
  await expect.element(alpha.getByText("Add Jordan Lee", { exact: true })).toBeVisible();
  expect(alpha.getByRole("button", { name: /Do it now:/u }).elements()).toHaveLength(2);
  const beta = page.getByRole("region", { name: "Beta" });
  await expect.element(beta.getByText("Drop Owen Park", { exact: true })).toBeVisible();
  await expect.element(beta.getByText("Add Sam Rivers", { exact: true })).toBeVisible();
  expect(beta.getByRole("button", { name: /Change date:/u }).elements()).toHaveLength(2);
  expect(page.getByRole("heading", { name: "Alpha" }).elements()).toHaveLength(1);
  expect(page.getByRole("heading", { name: "Beta" }).elements()).toHaveLength(1);
});

it("keeps the compact submit line on a phone and focuses today when filtered", async () => {
  const todayItem = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d2",
    drops: [player("Riley Chen", "D", "TOR")],
  });
  const futureItem = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d3",
    drops: [player("Owen Park", "D", "TOR")],
    window: "2026-11-15",
    lifecycle: "scheduled",
  });
  await page.viewport(390, 844);
  try {
    using _app = setupTransactionsPage({
      open: listData([
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
      ]),
      closed: listData([]),
    });

    await expect.element(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect.element(page.getByText("2 open moves", { exact: true })).toBeVisible();
    await expect.element(page.getByText("1 today · 1 scheduled", { exact: true })).toBeVisible();
    await expect.element(page.getByText("1 move today", { exact: true })).toBeVisible();
    const phoneSubmit = page.getByRole("button", { name: "Submit today's moves" });
    await expect.element(phoneSubmit).toBeDisabled();
    await expect
      .element(page.getByRole("link", { name: /Transactions 2 open moves/ }))
      .toBeVisible();
    const root = document.documentElement;
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);

    await page.getByRole("button", { name: /Do it now: Drop Riley Chen/u }).click();
    await expect.element(phoneSubmit).toBeEnabled();

    const onlyToday = page.getByRole("button", { name: "Only today" });
    await expect.element(onlyToday).toHaveAttribute("aria-pressed", "false");
    await onlyToday.click();
    await expect.element(onlyToday).toHaveAttribute("aria-pressed", "true");
    await expect
      .element(page.getByText("Showing today only. Press again to see every open move."))
      .toBeVisible();
    expect(page.getByRole("heading", { name: "Scheduled" }).elements()).toHaveLength(0);
    expect(page.getByRole("heading", { name: "Earlier" }).elements()).toHaveLength(0);
    await expect.element(page.getByText("Drop Riley Chen", { exact: true })).toBeVisible();
    expect(page.getByText("Drop Owen Park", { exact: true }).elements()).toHaveLength(0);

    await page.viewport(1440, 900);
    await expect
      .element(page.getByRole("button", { name: "Submit today's chosen moves" }))
      .toBeEnabled();
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
