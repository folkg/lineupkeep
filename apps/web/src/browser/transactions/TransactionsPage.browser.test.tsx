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
import type {
  DismissTransactionProposalData,
  DismissTransactionProposalRequest,
  TransactionProposalItemView,
  TransactionProposalListData,
  TransactionProposalListRequest,
  TransactionProposalSetSummaryView,
  TransactionReviewPlayerView,
  TransactionReviewView,
} from "#contracts/connections/transactionContract.ts";

import { TransactionReviewFailure } from "./transactionFailure";
import { transactionQueries } from "./transactionQueries";
import type { TransactionRemote } from "./transactionRemote";
import { TransactionsPage } from "./TransactionsPage";

const teamId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1";
const openPlanId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165b1";
const secondPlanId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165b2";
const historyPlanId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165b3";
const now = new Date().toISOString();
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1_000).toISOString();

it("renders open and stale sections with their reasons", async () => {
  using _app = setupTransactionsPage(openList());

  await expect.element(page.getByRole("heading", { name: "Alpha" })).toBeVisible();
  await expect.element(page.getByRole("link", { name: "Back to Alpha" })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Open plans" })).toBeVisible();
  await expect.element(page.getByText("Drop Riley Chen", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Stale" })).toBeVisible();
  await expect.element(page.getByText("Add Jordan Lee", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText(
        "Jordan Lee is already rostered in this league, so the add can no longer be made.",
      ),
    )
    .toBeVisible();
  await expect.element(page.getByText("Illegal roster position")).toBeVisible();
  await expect.element(page.getByText(/choosing which player to drop is yours/u)).toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "Review and submit" }))
    .toHaveAttribute("href", `/transactions/${openPlanId}`);
  await expect.element(page.getByText(/Proposed by an agent from Draft Desk/u)).toBeVisible();
});

it("dismisses one item from the list, keeps the others, and moves focus to the next control", async () => {
  const first = item({ id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c1" });
  const second = item({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c2",
    drops: [player("Owen Park", "D", "TOR")],
    reason: "Open another roster place.",
  });
  let current = listData([plan({ items: [first, second] })]);
  const requests: Array<DismissTransactionProposalRequest> = [];
  let resolveDismissal = (_data: DismissTransactionProposalData): void => {};
  const pendingDismissal = new Promise<DismissTransactionProposalData>((resolve) => {
    resolveDismissal = resolve;
  });
  using _app = setupTransactionsPage(current, undefined, {
    list: () => Promise.resolve(current),
    dismiss: (input) => {
      requests.push(input);
      return pendingDismissal;
    },
  });

  const firstButton = page.getByRole("button", { name: /Dismiss: Drop Riley Chen/u });
  await expect.element(firstButton).toBeVisible();
  firstButton.element().focus();
  await firstButton.click();

  expect(requests).toStrictEqual([{ set: openPlanId, items: [first.id] }]);
  await expect
    .element(page.getByRole("button", { name: /Dismissing: Drop Riley Chen/u }))
    .toHaveAttribute("aria-busy", "true");
  await expect.element(page.getByText("Dismissing move", { exact: true })).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: /Dismiss: Drop Owen Park/u }))
    .not.toHaveAttribute("aria-busy");

  current = listData([plan({ items: [second] })]);
  resolveDismissal({ outcome: "dismissed", review: review(openPlanId) });

  await expect.element(page.getByText("Drop Riley Chen", { exact: true })).not.toBeInTheDocument();
  await expect.element(page.getByText("Drop Owen Park", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Dismissed Drop Riley Chen.")).toBeVisible();
  expect(document.activeElement).toBe(
    page.getByRole("button", { name: /Dismiss: Drop Owen Park/u }).element(),
  );
});

it("shows a closed plan with the reason a dismissed move carries", async () => {
  using _app = setupTransactionsPage(openList(), historyList());

  await expect.element(page.getByText("Not this week.", { exact: true })).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Show history" }).click();

  await expect.element(page.getByRole("heading", { name: "History" })).toBeVisible();
  await expect.element(page.getByText("Dismissed", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Not this week.", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Dismissed from this plan")).toBeVisible();
  await expect.element(page.getByText("Executed", { exact: true })).toBeVisible();
  expect(page.getByRole("button", { name: /Dismiss/u }).elements()).toHaveLength(3);
});

it("shows more plans without losing the first page", async () => {
  const first = plan({ id: openPlanId, items: [item()] });
  const second = plan({
    id: secondPlanId,
    items: [
      item({
        id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c3",
        drops: [player("Casey Trail", "LW", "SEA")],
        reason: "Open a wing place.",
      }),
    ],
  });
  const requests: Array<TransactionProposalListRequest> = [];
  using _app = setupTransactionsPage(
    listData([first], { returned: 1, complete: false, remaining: 1, next: "page-2", total: 2 }),
    undefined,
    {
      list: (input) => {
        requests.push(input);
        return Promise.resolve(
          input.cursor === "page-2"
            ? listData([second], { returned: 1, complete: true, remaining: 0, total: 2 })
            : listData([first], {
                returned: 1,
                complete: false,
                remaining: 1,
                next: "page-2",
                total: 2,
              }),
        );
      },
    },
  );

  await expect.element(page.getByText("Drop Riley Chen", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show more" }).click();

  await expect.element(page.getByText("Drop Casey Trail", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Drop Riley Chen", { exact: true })).toBeVisible();
  expect(requests).toStrictEqual([{ team: teamId, state: "open", cursor: "page-2" }]);
});

it("keeps a move in place and names why it was not dismissed", async () => {
  using _app = setupTransactionsPage(openList(), undefined, {
    dismiss: () => Promise.reject(new TransactionReviewFailure("transactions.items_not_open")),
  });

  await page.getByRole("button", { name: /Dismiss: Drop Riley Chen/u }).click();

  await expect.element(page.getByText("Drop Riley Chen", { exact: true })).toBeVisible();
  await expect
    .element(
      page
        .getByText(
          "That move is no longer open, so nothing was dismissed. Reload the plan to see its state.",
        )
        .first(),
    )
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: /Dismiss: Drop Riley Chen/u }))
    .not.toHaveAttribute("aria-busy");
  await expect.element(page.getByText("Dismissed", { exact: true })).not.toBeInTheDocument();
});

it("keeps the plans and controls inside a phone viewport without sideways scroll", async () => {
  await page.viewport(390, 844);
  try {
    using _app = setupTransactionsPage(openList());

    await expect.element(page.getByRole("heading", { name: "Open plans" })).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Review and submit" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Show history" })).toBeVisible();
    const root = document.documentElement;
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    for (const element of [
      page.getByRole("link", { name: "Review and submit" }).element(),
      page.getByRole("button", { name: "Show history" }).element(),
      page.getByRole("button", { name: /Dismiss: Drop Riley Chen/u }).element(),
    ]) {
      const bounds = element.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(root.clientWidth);
    }
  } finally {
    await page.viewport(1280, 720);
  }
});

function setupTransactionsPage(
  open: TransactionProposalListData,
  history: TransactionProposalListData = listData([]),
  options: {
    readonly list?: TransactionRemote["list"];
    readonly dismiss?: TransactionRemote["dismiss"];
  } = {},
): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const remote: TransactionRemote = {
    read: () => Promise.reject(new Error("Unexpected review read")),
    list: options.list ?? ((input) => Promise.resolve(input.state === "closed" ? history : open)),
    submit: () => Promise.reject(new Error("Unexpected submission")),
    dismiss:
      options.dismiss ??
      ((input) => Promise.resolve({ outcome: "dismissed", review: review(input.set) })),
    withdraw: () => Promise.reject(new Error("Unexpected withdrawal")),
  };
  const openQuery = transactionQueries.list(remote, { team: teamId, state: "open" });
  queryClient.setQueryData(openQuery.queryKey, { pages: [open], pageParams: [undefined] });
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
  const transactionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/teams/$teamId/transactions",
    component: () => <TransactionsPage teamId={teamId} remote={remote} />,
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
  const reviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/transactions/$setId",
    component: () => <p>Review</p>,
  });
  const accountRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/account",
    component: () => <p>Account</p>,
  });
  const router = createRouter({
    context: { queryClient, sessionRemote },
    history: createMemoryHistory({ initialEntries: [`/teams/${teamId}/transactions`] }),
    routeTree: rootRoute.addChildren([
      transactionsRoute,
      teamRoute,
      teamsRoute,
      reviewRoute,
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

function openList(): TransactionProposalListData {
  return listData([
    plan({
      items: [
        item(),
        item({
          id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c4",
          kind: "free_agent_add",
          adds: [player("Jordan Lee", "WR", "SEA", "Questionable")],
          drops: [],
          reason: "Add a receiver.",
          staleness: {
            status: "stale",
            checkedAt: now,
            reasons: [
              {
                code: "player_unavailable",
                detail:
                  "Jordan Lee is already rostered in this league, so the add can no longer be made.",
              },
            ],
          },
        }),
        item({
          id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c5",
          drops: [player("Morgan Reed", "D", "TOR")],
          reason: "Drop the illegal defenseman.",
          staleness: {
            status: "illegal",
            checkedAt: now,
            reasons: [
              {
                code: "slot_illegal",
                detail:
                  "Morgan Reed is in the IR slot, but it does not accept his positions. No open slot accepts him, and choosing which player to drop is yours.",
              },
            ],
          },
        }),
      ],
    }),
  ]);
}

function historyList(): TransactionProposalListData {
  return listData([
    plan({
      id: historyPlanId,
      closed: true,
      items: [
        item({
          id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c6",
          state: "dismissed",
          settled: true,
          outcomeDetail: "Not this week.",
        }),
        item({
          id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c7",
          state: "executed",
          settled: true,
          drops: [player("Owen Park", "D", "TOR")],
          reason: "Drop the open roster place.",
        }),
      ],
    }),
  ]);
}

function plan(
  overrides: Partial<TransactionProposalSetSummaryView> & {
    readonly items?: ReadonlyArray<TransactionProposalItemView>;
  } = {},
): TransactionProposalSetSummaryView {
  const { items = [], ...rest } = overrides;
  const id = overrides.id ?? openPlanId;
  return {
    id,
    proposedBy: { kind: "agent", surface: "mcp", client: "Draft Desk" },
    createdAt: oneHourAgo,
    updatedAt: now,
    closed: false,
    reviewPath: `/transactions/${id}`,
    teams: [
      {
        team: {
          id: teamId,
          name: "Alpha",
          league: "nfl",
          sport: "football",
          season: 2026,
        },
        items,
      },
    ],
    ...rest,
  };
}

function item(overrides: Partial<TransactionProposalItemView> = {}): TransactionProposalItemView {
  return {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d1",
    kind: "drop",
    adds: [],
    drops: [player("Riley Chen", "D", "TOR")],
    picks: [],
    reason: "Drop the open roster place.",
    state: "proposed",
    settled: false,
    staleness: { status: "current", checkedAt: now, reasons: [] },
    ...overrides,
  };
}

function listData(
  sets: ReadonlyArray<TransactionProposalSetSummaryView>,
  overrides: Partial<TransactionProposalListData["page"]> = {},
): TransactionProposalListData {
  return {
    status: "ok",
    team: {
      id: teamId,
      name: "Alpha",
      league: "nfl",
      sport: "football",
      season: 2026,
    },
    sets,
    page: {
      returned: sets.length,
      complete: true,
      remaining: 0,
      total: sets.length,
      ...overrides,
    },
  };
}

function review(set: string): TransactionReviewView {
  return {
    set: {
      id: set,
      proposedBy: { kind: "agent", surface: "mcp" },
      createdAt: oneHourAgo,
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
