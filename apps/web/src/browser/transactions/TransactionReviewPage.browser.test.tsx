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
import { page, userEvent } from "vitest/browser";

import "#web/styles.css";

import type { RouterContext } from "#browser/app-shell/routerContext.ts";
import { createQueryClient } from "#browser/query/queryClient.ts";
import type { SessionRemote } from "#browser/session/sessionRemote.ts";
import type {
  TransactionReviewItemView,
  TransactionReviewPlayerView,
  TransactionReviewTeamView,
  TransactionReviewView,
} from "#contracts/connections/transactionContract.ts";

import { transactionQueries } from "./transactionQueries";
import type { TransactionRemote } from "./transactionRemote";
import { TransactionReviewPage } from "./TransactionReviewPage";

const setId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1";
const alphaId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165a2";
const betaId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165a3";
const gammaId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165a4";

const now = new Date().toISOString();
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1_000).toISOString();
const twentyThreeHours = new Date(Date.now() + 23 * 60 * 60 * 1_000).toISOString();
const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1_000).toISOString();

it("renders a two-team proposal, a quiet team, and one disabled action", async () => {
  using _app = setupReviewPage(reviewFixture());

  await expect.element(page.getByRole("heading", { name: "Proposed moves" })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Alpha" })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Beta" })).toBeVisible();
  await expect.element(page.getByText("NFL · Football 2026")).toBeVisible();
  await expect.element(page.getByText("NHL · Hockey 2026")).toBeVisible();
  await expect.element(page.getByText("Sam Rivers", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Alex Vance", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Cover the receiver spot before Sunday.")).toBeVisible();
  await expect.element(page.getByText(/Checked against current state/u)).toBeVisible();

  await expect
    .element(page.getByRole("heading", { name: "Teams with nothing proposed" }))
    .toBeVisible();
  await expect.element(page.getByText("Gamma", { exact: true })).toBeVisible();

  await expect.element(page.getByRole("checkbox", { name: /Add Sam Rivers/u })).toBeChecked();
  await expect
    .element(page.getByRole("button", { name: "Submit 3 moves" }))
    .toHaveAttribute("aria-disabled", "true");
  await expect
    .element(page.getByText("3 of 4 moves included. 1 waiver claim spends 25 FAAB."))
    .toBeVisible();
});

it("starts a stale move excluded, marks its reason, and does not let it be included", async () => {
  using _app = setupReviewPage(reviewFixture());

  const stale = page.getByRole("checkbox", { name: /Add Jordan Lee/u });
  await expect.element(stale).not.toBeChecked();
  await expect.element(stale).toBeDisabled();
  await expect.element(page.getByText("No longer current")).toBeVisible();
  await expect
    .element(
      page.getByText(
        "Jordan Lee is already rostered in this league, so the add can no longer be made.",
      ),
    )
    .toBeVisible();
  await expect
    .element(page.getByText("3 of 4 moves included. 1 waiver claim spends 25 FAAB."))
    .toBeVisible();
});

it("updates the tally when a person leaves out a current move", async () => {
  using _app = setupReviewPage(reviewFixture());

  const waiver = page.getByRole("checkbox", { name: /Add Sam Rivers/u });
  await expect.element(waiver).toBeChecked();
  await waiver.click();
  await expect.element(waiver).not.toBeChecked();
  await expect.element(page.getByText("2 of 4 moves included. No FAAB is spent.")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Submit 2 moves" }))
    .toHaveAttribute("aria-disabled", "true");

  await waiver.click();
  await expect.element(waiver).toBeChecked();
  await expect
    .element(page.getByRole("button", { name: "Submit 3 moves" }))
    .toHaveAttribute("aria-disabled", "true");
});

it("toggles a move from the keyboard", async () => {
  using _app = setupReviewPage(reviewFixture());

  const waiver = page.getByRole("checkbox", { name: /Add Sam Rivers/u });
  await expect.element(waiver).toBeChecked();
  waiver.element().focus();
  await userEvent.keyboard(" ");
  await expect.element(waiver).not.toBeChecked();
  await expect.element(page.getByText("2 of 4 moves included. No FAAB is spent.")).toBeVisible();

  await userEvent.keyboard(" ");
  await expect.element(waiver).toBeChecked();
});

it("keeps teams with nothing proposed in a quiet section at the end", async () => {
  using _app = setupReviewPage({
    ...reviewFixture(),
    teams: [
      teamFixture(alphaId, "Alpha", "nfl", "football", [waiverItem()]),
      teamFixture(betaId, "Beta", "nhl", "hockey", []),
      teamFixture(gammaId, "Gamma", "nhl", "hockey", []),
      teamFixture("018f79ea-7d86-7c18-9b4a-8b4d0c9165a5", "Delta", "nfl", "football", []),
    ],
  });

  await expect
    .element(page.getByRole("heading", { name: "Teams with nothing proposed" }))
    .toBeVisible();
  await expect.element(page.getByText("Beta, Gamma, Delta")).toBeVisible();
});

it("says an expired set offers nothing to do", async () => {
  using _app = setupReviewPage({
    ...reviewFixture(),
    set: {
      ...reviewFixture().set,
      expired: true,
      expiresAt: twoHoursAgo,
    },
  });

  await expect.element(page.getByText(/Nothing can be submitted from this set/u)).toBeVisible();
  await expect.element(page.getByText(/^Expired/u)).toBeVisible();
  expect(page.getByRole("checkbox").elements()).toHaveLength(0);
  await expect.element(page.getByRole("heading", { name: "Submission" })).not.toBeInTheDocument();
  expect(page.getByRole("button", { name: /Submit/u }).elements()).toHaveLength(0);
});

it("says nothing was proposed for an empty set", async () => {
  using _app = setupReviewPage({
    ...reviewFixture(),
    teams: [
      teamFixture(alphaId, "Alpha", "nfl", "football", []),
      teamFixture(betaId, "Beta", "nhl", "hockey", []),
    ],
  });

  await expect.element(page.getByText("Nothing was proposed.")).toBeVisible();
  expect(page.getByRole("checkbox").elements()).toHaveLength(0);
  await expect.element(page.getByRole("heading", { name: "Submission" })).not.toBeInTheDocument();
});

function reviewFixture(): TransactionReviewView {
  return {
    set: {
      id: setId,
      proposedBy: { kind: "agent", surface: "mcp" },
      createdAt: oneHourAgo,
      expiresAt: twentyThreeHours,
      expired: false,
    },
    teams: [
      teamFixture(alphaId, "Alpha", "nfl", "football", [
        waiverItem(),
        staleItem(),
        freeAgentItem(),
      ]),
      teamFixture(betaId, "Beta", "nhl", "hockey", [dropItem()]),
      teamFixture(gammaId, "Gamma", "nhl", "hockey", []),
    ],
  };
}

function teamFixture(
  id: string,
  name: string,
  league: "nfl" | "nhl",
  sport: "football" | "hockey",
  items: ReadonlyArray<TransactionReviewItemView>,
): TransactionReviewTeamView {
  return {
    team: { id, name, league, sport, season: 2026 },
    ...(items.some((item) => item.kind === "waiver_claim")
      ? { budget: { status: "published" as const, remaining: 50 } }
      : {}),
    items,
  };
}

function waiverItem(): TransactionReviewItemView {
  return {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b1",
    kind: "waiver_claim",
    adds: [player("Sam Rivers", "WR", "SEA", "Questionable")],
    drops: [player("Alex Vance", "RB", "SF", "Out")],
    bid: 25,
    reason: "Cover the receiver spot before Sunday.",
    staleness: { status: "current", checkedAt: now, reasons: [] },
  };
}

function staleItem(): TransactionReviewItemView {
  return {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b2",
    kind: "free_agent_add",
    adds: [player("Jordan Lee", "C", "BOS", "Free agent")],
    drops: [],
    reason: "Add a center for the light night.",
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
  };
}

function freeAgentItem(): TransactionReviewItemView {
  return {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b3",
    kind: "free_agent_add",
    adds: [player("Mika Olsen", "LW", "NYR", "Free agent")],
    drops: [player("Tomas Berg", "RW", "BOS")],
    reason: "Take the better wing before the weekend.",
    staleness: { status: "current", checkedAt: now, reasons: [] },
  };
}

function dropItem(): TransactionReviewItemView {
  return {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b4",
    kind: "drop",
    adds: [],
    drops: [player("Riley Chen", "LW", "NYR")],
    reason: "Open a roster spot.",
    staleness: { status: "current", checkedAt: now, reasons: [] },
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

it("captures the review for visual inspection", async () => {
  using _app = setupReviewPage(reviewFixture());
  await expect.element(page.getByRole("heading", { name: "Alpha" })).toBeVisible();

  const captures = [
    { name: "review-390-light", width: 390, height: 844, dark: false },
    { name: "review-390-dark", width: 390, height: 844, dark: true },
    { name: "review-desktop-light", width: 1280, height: 900, dark: false },
    { name: "review-desktop-dark", width: 1280, height: 900, dark: true },
  ] as const;

  try {
    for (const capture of captures) {
      await page.viewport(capture.width, capture.height);
      document.documentElement.classList.toggle("dark", capture.dark);
      const fullHeight = Math.max(
        capture.height,
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      await page.viewport(capture.width, fullHeight);
      await page.screenshot({
        path: `../../../../../.artifacts/transactions-review/${capture.name}.png`,
      });
    }
  } finally {
    document.documentElement.classList.remove("dark");
    await page.viewport(1280, 720);
  }
});

function setupReviewPage(review: TransactionReviewView): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const remote: TransactionRemote = {
    read: () => Promise.resolve(review),
  };
  const reviewQuery = transactionQueries.review(remote, review.set.id);
  queryClient.setQueryData(reviewQuery.queryKey, review);
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
  const reviewRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/transactions/$setId",
    component: () => <TransactionReviewPage reviewQuery={() => reviewQuery} />,
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
  const connectionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/connections",
    component: () => <p>Connections</p>,
  });
  const router = createRouter({
    context: { queryClient, sessionRemote },
    history: createMemoryHistory({ initialEntries: [`/transactions/${review.set.id}`] }),
    routeTree: rootRoute.addChildren([reviewRoute, teamRoute, teamsRoute, connectionsRoute]),
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
