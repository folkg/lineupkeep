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
  TransactionConfirmRequest,
  TransactionMoveListData,
  TransactionMoveTeamDayView,
  TransactionMoveView,
  TransactionPlanGroupView,
  TransactionSaveMoveRequest,
} from "#contracts/connections/transactionContract.ts";

import { transactionQueries } from "./transactionQueries.ts";
import type { TransactionRemote } from "./transactionRemote.ts";
import { TransactionsNavLink } from "./TransactionsNavLink.tsx";
import { TransactionsPage } from "./TransactionsPage.tsx";

type TransactionMoveTeamView = TransactionMoveView["team"];

const alpha: TransactionMoveTeamView = {
  id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1",
  name: "Alpha",
  league: "nfl",
  sport: "football",
  season: 2026,
};
const beta: TransactionMoveTeamView = {
  id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a2",
  name: "Beta",
  league: "nhl",
  sport: "hockey",
  season: 2026,
};
const today = "2026-11-11";
const now = "2026-11-11T16:05:00.000Z";

it("shows every team's moves today and keeps saved moves on per team planning sheets", async () => {
  await page.viewport(1280, 900);
  const drop = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b1",
    team: alpha,
    kind: "drop",
    drops: [player("Riley Chen")],
    reason: "Open a bench place for the incoming receiver.",
  });
  const add = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b2",
    team: beta,
    kind: "free_agent_add",
    adds: [player("Jordan Lee")],
    drops: [],
    reason: "Add a receiver for tonight.",
  });
  const savedWaiver = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b3",
    team: alpha,
    kind: "waiver_claim",
    decision: "saved",
    runDay: "2026-11-12",
    effectiveDate: "2026-11-13",
    adds: [player("Amon-Ra St. Brown")],
    drops: [player("Romeo Doubs")],
    reason: "Claim a receiver for the weekend.",
  });
  const savedAdd = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b4",
    team: beta,
    kind: "free_agent_add",
    decision: "saved",
    runDay: "2026-11-14",
    adds: [player("Tank Bigsby")],
    drops: [player("Tyler Boyd")],
    reason: "Cover the bench for a bye.",
  });
  using _app = setupTransactionsPage({
    open: listData([drop, add, savedWaiver, savedAdd], { open: 4, today: 2, saved: 2, ended: 0 }),
  });

  await expect.element(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
  await expect.element(page.getByText("4 open moves", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText("· 2 today · 2 saved · 2 teams", { exact: true }))
    .toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect.element(page.getByText("2 moves for today", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Drop Riley Chen", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Add Jordan Lee", { exact: true })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Saved for later" })).toBeVisible();
  await expect
    .element(
      page
        .getByRole("region", { name: "Alpha" })
        .getByText("Claim Amon-Ra St. Brown and drop Romeo Doubs", { exact: true }),
    )
    .toBeVisible();
  await expect
    .element(
      page
        .getByRole("region", { name: "Beta" })
        .getByText("Add Tank Bigsby and drop Tyler Boyd", { exact: true }),
    )
    .toBeVisible();
  await expect
    .element(page.getByText(formatCalendarDate("2026-11-12"), { exact: true }).first())
    .toBeVisible();
  await expect
    .element(page.getByText(formatCalendarDate("2026-11-13"), { exact: true }).first())
    .toBeVisible();
});

it("shows the active places and each reserve list the league publishes", async () => {
  await page.viewport(1280, 900);
  const drop = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c0",
    team: alpha,
    kind: "drop",
    drops: [player("Riley Chen")],
  });
  using _app = setupTransactionsPage({
    open: listData([drop], { open: 1, today: 1, saved: 0, ended: 0 }, [
      {
        team: alpha.id,
        places: { used: 5, maximum: 5, free: 0 },
        reserve: [
          {
            name: "IR",
            eligibility: { kind: "injury_status" },
            capacity: 2,
            occupied: 1,
            free: 1,
          },
        ],
      },
    ]),
  });

  await expect
    .element(page.getByText("Places: 5 of 5 used, 0 free.", { exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByText("IR: 1 of 2 used, 1 free, accepts an injured player.", { exact: true }))
    .toBeVisible();
});

it("confirms today's move, runs it, and returns the recorded outcome", async () => {
  await page.viewport(1280, 900);
  const first = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c1",
    team: alpha,
    kind: "drop",
    drops: [player("Riley Chen")],
  });
  const second = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c2",
    team: beta,
    kind: "free_agent_add",
    adds: [player("Jordan Lee")],
    drops: [],
    reason: "Add a receiver now.",
  });
  const confirmed: Array<TransactionConfirmRequest> = [];
  using _app = setupTransactionsPage({
    open: listData([first, second], { open: 2, today: 2, saved: 0, ended: 0 }),
    confirm: (input) => {
      confirmed.push(input);
      return Promise.resolve({
        status: "confirmed",
        confirmed: input.moves,
        counts: { moves: 1, executed: 1, pending: 0, failed: 0, skipped: 0, unknown: 0 },
        refusals: [],
      });
    },
  });

  await expect.element(page.getByText(/2 moves still need your confirmation/u)).toBeVisible();
  await expect
    .element(page.getByText("Nothing runs until you confirm it.", { exact: true }).first())
    .toBeVisible();

  await page.getByRole("button", { name: /Confirm and run: Drop Riley Chen/u }).click();

  await expect.element(page.getByText("Confirmed and ran 1 move.", { exact: true })).toBeVisible();
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]?.team).toBe(alpha.id);
  expect(confirmed[0]?.moves).toStrictEqual([first.move]);
  expect(confirmed[0]?.key.length).toBeGreaterThan(0);
});

it("confirms a saved move for its day without running it", async () => {
  await page.viewport(1280, 900);
  const saved = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c3",
    team: alpha,
    kind: "waiver_claim",
    decision: "saved",
    runDay: "2026-11-13",
    adds: [player("Amon-Ra St. Brown")],
    drops: [player("Romeo Doubs")],
    reason: "Claim a receiver for the weekend.",
  });
  const confirmed: Array<TransactionConfirmRequest> = [];
  using _app = setupTransactionsPage({
    open: listData([saved], { open: 1, today: 0, saved: 1, ended: 0 }),
    confirm: (input) => {
      confirmed.push(input);
      return Promise.resolve({
        status: "confirmed",
        confirmed: input.moves,
        counts: { moves: 0, executed: 0, pending: 0, failed: 0, skipped: 0, unknown: 0 },
        refusals: [],
      });
    },
  });

  await page.getByRole("button", { name: /Confirm: Claim Amon-Ra St. Brown/u }).click();

  await expect
    .element(page.getByText("Confirmed 1 move. It runs on its day's check.", { exact: true }))
    .toBeVisible();
  expect(confirmed[0]?.moves).toStrictEqual([saved.move]);
});

it("shows undecided, confirmed, ran, and discarded moves in plain words", async () => {
  await page.viewport(1280, 900);
  const pending = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c4",
    team: alpha,
    kind: "drop",
    decision: "undecided",
    drops: [player("Riley Chen")],
  });
  const confirmed = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c5",
    team: alpha,
    kind: "waiver_claim",
    decision: "confirmed",
    runDay: "2026-11-13",
    adds: [player("Amon-Ra St. Brown")],
    confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" },
    decidedBy: "owner",
    surface: "transactions.confirm",
  });
  const ran = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c7",
    team: alpha,
    kind: "drop",
    decision: "now",
    drops: [player("Riley Chen")],
    confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" },
    runAt: "2026-11-11T18:05:00.000Z",
    result: "executed",
    decidedBy: "owner",
    surface: "transactions.confirm",
    runDecidedBy: "system",
    runSurface: "automation.run",
  });
  const discarded = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c6",
    team: beta,
    kind: "drop",
    decision: "discarded",
    decidedAt: "2026-11-10T15:10:00.000Z",
    drops: [player("Tyler Boyd")],
  });
  using _app = setupTransactionsPage({
    open: listData([pending, confirmed], { open: 2, today: 1, saved: 1, ended: 2 }),
    ended: listData([discarded, ran], { open: 0, today: 0, saved: 0, ended: 2 }),
  });

  await expect.element(page.getByText("Undecided", { exact: true }).first()).toBeVisible();
  await expect
    .element(page.getByText(`Confirmed for ${formatCalendarDate("2026-11-13")}`, { exact: true }))
    .toBeVisible();
  await expect
    .element(
      page.getByText(
        `You confirmed this on ${formatCalendarDate("2026-11-11T17:35:00.000Z")} in the app. It has not run yet.`,
        { exact: true },
      ),
    )
    .toBeVisible();

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByText("Ran on the check", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText(
        `You confirmed this on ${formatCalendarDate("2026-11-11T17:35:00.000Z")} in the app. The scheduled check ran it on the ${formatCalendarDate("2026-11-11T18:05:00.000Z")} check.`,
        { exact: true },
      ),
    )
    .toBeVisible();
  await expect.element(page.getByText("Discarded", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText(`You discarded this on ${formatCalendarDate("2026-11-10T15:10:00.000Z")}.`, {
        exact: true,
      }),
    )
    .toBeVisible();
});

it("names an agent's discard and the surface it happened on", async () => {
  await page.viewport(1280, 900);
  const discarded = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d1",
    team: beta,
    kind: "drop",
    decision: "discarded",
    decidedAt: "2026-11-10T15:10:00.000Z",
    decidedBy: "agent",
    surface: "discard_transaction_move",
    drops: [player("Tyler Boyd")],
  });
  using _app = setupTransactionsPage({
    open: listData([], { open: 0, today: 0, saved: 0, ended: 1 }),
    ended: listData([discarded], { open: 0, today: 0, saved: 0, ended: 1 }),
  });

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect
    .element(
      page.getByText(
        `An agent discarded this over discard_transaction_move on ${formatCalendarDate("2026-11-10T15:10:00.000Z")}.`,
        { exact: true },
      ),
    )
    .toBeVisible();
});

it("edits and discards one saved move at a time", async () => {
  await page.viewport(1280, 900);
  const first = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d1",
    team: alpha,
    kind: "drop",
    decision: "saved",
    runDay: "2026-11-13",
    drops: [player("Riley Chen")],
  });
  const second = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d2",
    team: alpha,
    kind: "free_agent_add",
    decision: "saved",
    runDay: "2026-11-13",
    adds: [player("Jordan Lee")],
    drops: [],
  });
  const saved: Array<TransactionSaveMoveRequest> = [];
  const discarded: Array<{ readonly team: string; readonly move: string }> = [];
  using _app = setupTransactionsPage({
    open: listData([first, second], { open: 2, today: 0, saved: 2, ended: 0 }),
    save: (input) => {
      saved.push(input);
      return Promise.resolve({ status: "saved", move: input.move });
    },
    discard: (input) => {
      discarded.push(input);
      return Promise.resolve({ status: "discarded", move: input.move });
    },
  });

  await expect.element(page.getByRole("region", { name: "Alpha" })).toBeVisible();
  expect(page.getByRole("button", { name: /Change date:/u }).elements()).toHaveLength(2);
  expect(page.getByRole("button", { name: /Discard:/u }).elements()).toHaveLength(2);

  await page.getByRole("button", { name: /Change date: Drop Riley Chen/u }).click();
  await expect
    .element(
      page.getByText("Saving changes the day this move runs and clears your confirmation.", {
        exact: true,
      }),
    )
    .toBeVisible();
  const date = page.getByLabelText("Run date");
  await expect.element(date).toHaveValue("2026-11-13");
  await date.fill("2026-11-17");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect
    .element(
      page.getByText(
        `Saved for ${formatCalendarDate("2026-11-17")}. It waits in Today that day until you confirm it.`,
        { exact: true },
      ),
    )
    .toBeVisible();
  expect(saved).toStrictEqual([{ team: alpha.id, move: first.move, runDay: "2026-11-17" }]);
  expect(page.getByLabelText("Run date").elements()).toHaveLength(0);

  await page.getByRole("button", { name: /Discard: Add Jordan Lee/u }).click();
  await expect.element(page.getByText("Discarded 1 move.", { exact: true })).toBeVisible();
  expect(discarded).toStrictEqual([{ team: alpha.id, move: second.move }]);
});

it("marks a move that cannot run and disables its choice", async () => {
  await page.viewport(1280, 900);
  const stale = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165e1",
    team: alpha,
    kind: "drop",
    drops: [player("Riley Chen")],
    validation: {
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
  const invalidSaved = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165e2",
    team: beta,
    kind: "free_agent_add",
    decision: "saved",
    runDay: "2026-11-13",
    adds: [player("Jordan Lee")],
    drops: [],
    validation: {
      status: "illegal",
      checkedAt: now,
      reasons: [
        {
          code: "player_unavailable",
          detail: "Jordan Lee is on waivers, so a free-agent add cannot bring them in.",
        },
      ],
    },
  });
  using _app = setupTransactionsPage({
    open: listData([stale, invalidSaved], { open: 2, today: 1, saved: 1, ended: 0 }),
  });

  await expect
    .element(
      page.getByText(
        "Riley Chen is no longer on this team's roster, so there is nothing to drop.",
        { exact: true },
      ),
    )
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: /Confirm and run: Drop Riley Chen/u }))
    .toBeDisabled();
  await expect
    .element(page.getByRole("button", { name: /Discard: Drop Riley Chen/u }))
    .toBeEnabled();
  await expect
    .element(
      page.getByText("Jordan Lee is on waivers, so a free-agent add cannot bring them in.", {
        exact: true,
      }),
    )
    .toBeVisible();
  expect(
    page.getByRole("button", { name: /Change date: Add Jordan Lee/u }).elements(),
  ).toHaveLength(0);
  await expect
    .element(page.getByRole("button", { name: /Discard: Add Jordan Lee/u }))
    .toBeEnabled();
});

it("shows clear teams when nothing is open", async () => {
  using _clear = setupTransactionsPage({
    open: listData([], { open: 0, today: 0, saved: 0, ended: 0 }),
    teamCount: 5,
  });

  await expect.element(page.getByText("0 open moves", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Nothing for today", { exact: true }).first()).toBeVisible();
  await expect.element(page.getByText("Nothing saved", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText(
        "Every team is clear. When you propose a change, it appears here with the day it waits for.",
        { exact: true },
      ),
    )
    .toBeVisible();
});

it("offers a retry when the read fails", async () => {
  using _failure = setupTransactionsPage({
    open: listData([], { open: 0, today: 0, saved: 0, ended: 0 }),
    failure: new Error("read failed"),
  });
  await expect
    .element(page.getByText("We could not load your open moves. Try again.", { exact: true }))
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

it("shows each group's status and the sentence that explains what ran", async () => {
  await page.viewport(1280, 900);
  const drop = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d1",
    team: alpha,
    kind: "drop",
    drops: [player("Riley Chen")],
  });
  const stash = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d2",
    team: alpha,
    kind: "stash",
    drops: [],
    intent: { kind: "stash", player: player("Amon-Ra St. Brown") },
  });
  const failed: TransactionPlanGroupView["failed"] = {
    move: stash.move,
    action: "reserve_move",
    player: "Amon-Ra St. Brown",
    toSlot: "IR",
    outcome: "failed",
    detail: "The player was already there.",
  };
  const sentence =
    "This group ran in part. The drop of Riley Chen reached your league. The move of Amon-Ra St. Brown to IR failed: The player was already there. Check your roster, then choose the move again or discard it.";
  using _app = setupTransactionsPage({
    open: listData(
      [drop, stash],
      { open: 2, today: 2, saved: 0, ended: 0 },
      [],
      [
        {
          group: "018f79ea-7d86-7c18-9b4a-8b4d0c9165e1",
          team: alpha.id,
          label: "Roster fixes",
          status: "partly_done",
          moves: [drop.move, stash.move],
          actions: [
            { move: drop.move, action: "drop", player: "Riley Chen", outcome: "executed" },
            failed,
          ],
          failed,
          notRun: [],
          detail: sentence,
          cure: "Check your roster, then choose the move again or discard it.",
        },
      ],
    ),
  });

  await expect.element(page.getByRole("heading", { name: "Groups" })).toBeVisible();
  await expect.element(page.getByText("Roster fixes", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText("These moves make the roster legal and free the places your move needs.", {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect.element(page.getByText("Ran in part", { exact: true })).toBeVisible();
  await expect.element(page.getByText(sentence, { exact: true })).toBeVisible();
});

it("keeps today's count and confirmation on a phone line", async () => {
  const only = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165f1",
    team: alpha,
    kind: "drop",
    drops: [player("Riley Chen")],
  });
  await page.viewport(390, 844);
  try {
    using _app = setupTransactionsPage({
      open: listData([only], { open: 1, today: 1, saved: 0, ended: 0 }),
    });

    await expect.element(page.getByText("1 move for today", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: /Confirm and run: Drop Riley Chen/u }))
      .toBeEnabled();
    const root = document.documentElement;
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  } finally {
    await page.viewport(1280, 720);
    await page.viewport(1280, 900);
  }
});

function setupTransactionsPage(options: {
  readonly open: TransactionMoveListData;
  readonly teamCount?: number;
  readonly failure?: Error;
  readonly confirm?: TransactionRemote["confirm"];
  readonly save?: TransactionRemote["save"];
  readonly discard?: TransactionRemote["discard"];
  readonly ended?: TransactionMoveListData;
}): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  const open =
    options.teamCount === undefined
      ? options.open
      : { ...options.open, teamCount: options.teamCount };
  const remote: TransactionRemote = {
    timeline: () =>
      options.failure === undefined ? Promise.resolve(open) : Promise.reject(options.failure),
    list: (input) =>
      Promise.resolve(
        input.state === "ended"
          ? (options.ended ?? listData([], { open: 0, today: 0, saved: 0, ended: 0 }))
          : open,
      ),
    plan: () =>
      Promise.resolve({
        team: alpha,
        snapshot: {
          status: "live",
          checkedAt: "2026-11-11T12:00:00.000Z",
          source: "week 1",
        },
        moves: [],
        days: [],
        groups: [],
      }),
    save: options.save ?? (() => Promise.reject(new Error("Unexpected save"))),
    discard: options.discard ?? (() => Promise.reject(new Error("Unexpected discard"))),
    confirm: options.confirm ?? (() => Promise.reject(new Error("Unexpected confirmation"))),
  };
  if (options.failure === undefined) {
    queryClient.setQueryData(transactionQueries.timeline(remote).queryKey, {
      pages: [open],
      pageParams: [undefined],
    });
    queryClient.setQueryData(transactionQueries.list(remote, { state: "ended" }).queryKey, {
      pages: [options.ended ?? listData([], { open: 0, today: 0, saved: 0, ended: 0 })],
      pageParams: [undefined],
    });
    queryClient.setQueryData(transactionQueries.openCountKey, open.counts.open);
  }
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
    routeTree: rootRoute.addChildren([transactionsRoute, teamRoute, teamsRoute, accountRoute]),
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

function listData(
  moves: ReadonlyArray<TransactionMoveView>,
  counts: TransactionMoveListData["counts"],
  teamFacts: TransactionMoveListData["teamFacts"] = [],
  groups: ReadonlyArray<TransactionPlanGroupView> = [],
): TransactionMoveListData {
  const todayMoves = moves.filter(
    (move) =>
      (move.decision === "now" || move.decision === "undecided") &&
      (move.runDay === undefined || move.runDay === today),
  );
  const savedMoves = moves.filter(
    (move) => (move.decision === "saved" || move.decision === "confirmed") && move.runDay !== today,
  );
  const days: Array<TransactionMoveListData["days"][number]> = [];
  if (todayMoves.length > 0) {
    days.push({ day: today, today: true, teams: group(todayMoves) });
  }
  for (const move of savedMoves) {
    days.push({
      day: move.runDay,
      today: false,
      teams: [{ team: move.team, moves: [move] }],
    });
  }
  return {
    status: "ok",
    moves,
    days,
    teamFacts,
    counts,
    teamCount: uniqueTeams(moves),
    groups,
    page: { returned: moves.length, complete: true },
  };
}

function group(
  moves: ReadonlyArray<TransactionMoveView>,
): ReadonlyArray<TransactionMoveTeamDayView> {
  const byTeam = new Map<
    string,
    { team: TransactionMoveTeamView; moves: Array<TransactionMoveView> }
  >();
  for (const move of moves) {
    const held = byTeam.get(move.team.id);
    if (held === undefined) {
      byTeam.set(move.team.id, { team: move.team, moves: [move] });
    } else {
      held.moves.push(move);
    }
  }
  return [...byTeam.values()];
}

function uniqueTeams(moves: ReadonlyArray<TransactionMoveView>): number {
  return new Set(moves.map((move) => move.team.id)).size;
}

function move(
  overrides: Partial<TransactionMoveView> & { readonly team: TransactionMoveTeamView },
): TransactionMoveView {
  return {
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a9",
    kind: "drop",
    position: 0,
    decision: "undecided",
    reason: "Make the roster change.",
    adds: [],
    fallbacks: [],
    drops: [player("Riley Chen")],
    picks: [],
    validation: { status: "current", checkedAt: now, reasons: [] },
    check: { status: "checked" },
    ...overrides,
    team: overrides.team,
  };
}

function player(name: string): { readonly name: string } {
  return { name };
}
