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
  TransactionMoveConfirmationData,
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
import {
  confirmationLine,
  discardLine,
  resultDetailLine,
  resultTimeLine,
  scheduledRunLine,
  waitingOnLeagueLine,
} from "./transactionTimes.ts";

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
const nextRunAt = "2026-11-11T21:55:00.000Z";

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
  await expect
    .element(page.getByRole("heading", { name: formatCalendarDate("2026-11-12") }))
    .toBeVisible();
  await expect
    .element(page.getByRole("heading", { name: formatCalendarDate("2026-11-14") }))
    .toBeVisible();
  await expect
    .element(
      page
        .getByRole("region", { name: formatCalendarDate("2026-11-12") })
        .getByText("Claim Amon-Ra St. Brown and drop Romeo Doubs", { exact: true }),
    )
    .toBeVisible();
  await expect
    .element(
      page
        .getByRole("region", { name: formatCalendarDate("2026-11-14") })
        .getByText("Add Tank Bigsby and drop Tyler Boyd", { exact: true }),
    )
    .toBeVisible();
  await expect
    .element(page.getByText(`Takes effect ${formatCalendarDate("2026-11-13")}.`, { exact: true }))
    .toBeVisible();
});

it("names every effect an activate carries, including its funding drop", async () => {
  await page.viewport(1280, 900);
  const activating = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b5",
    team: alpha,
    kind: "activate",
    drops: [player("Anton Frondell")],
    intent: { kind: "activate", player: player("Jake Neighbours") },
  });
  using _app = setupTransactionsPage({
    open: listData([activating], { open: 1, today: 1, saved: 0, ended: 0 }),
  });

  await expect
    .element(page.getByText("Activate Jake Neighbours, drop Anton Frondell", { exact: true }))
    .toBeVisible();
});

it("keeps a failed move's reason and time on its row", async () => {
  await page.viewport(1280, 900);
  const failed = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b6",
    team: alpha,
    kind: "drop",
    decision: "now",
    drops: [player("Riley Chen")],
    result: "failed",
    resultDetail: "Your league refused the drop.",
    resultAt: "2026-11-11T16:05:00.000Z",
  });
  using _app = setupTransactionsPage({
    open: listData([failed], { open: 1, today: 1, saved: 0, ended: 0 }),
  });

  await expect.element(page.getByText("Failed", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText(resultDetailLine(failed) ?? "", { exact: true }))
    .toBeVisible();
  await expect.element(page.getByText(resultTimeLine(failed) ?? "", { exact: true })).toBeVisible();
});

it("folds the active places and each reserve list into a blocked card's explanation", async () => {
  await page.viewport(1280, 900);
  const drop = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c0",
    team: alpha,
    kind: "drop",
    drops: [player("Riley Chen")],
    validation: {
      status: "stale",
      checkedAt: now,
      reasons: [{ code: "drop_not_rostered", detail: "Riley Chen is not on the roster." }],
    },
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

  await expect.element(page.getByText("Blocked", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText("Places: 5 of 5 used, 0 free.", { exact: true }))
    .not.toBeVisible();
  await page.getByText("Why these moves", { exact: true }).click();
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

  await page.getByRole("button", { name: /Confirm group and run now: Drop Riley Chen/u }).click();

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

  await page.getByRole("button", { name: /Confirm group: Claim Amon-Ra St. Brown/u }).click();

  await expect
    .element(
      page.getByText(`Confirmed 1 move. ${scheduledRunLine("2026-11-13", nextRunAt)}.`, {
        exact: true,
      }),
    )
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
  await expect.element(page.getByText("Confirmed", { exact: true }).first()).toBeVisible();
  await expect
    .element(page.getByText(confirmationLine(confirmed) ?? "", { exact: true }))
    .toBeVisible();
  await expect
    .element(
      page.getByText(`${scheduledRunLine("2026-11-13", nextRunAt)}.`, { exact: true }).first(),
    )
    .toBeVisible();

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByText("Ran on schedule", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText(confirmationLine(ran) ?? "", { exact: true }).first())
    .toBeVisible();
  await expect.element(page.getByText("Discarded", { exact: true })).toBeVisible();
  await expect.element(page.getByText(discardLine(discarded) ?? "", { exact: true })).toBeVisible();
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
  await expect.element(page.getByText(discardLine(discarded) ?? "", { exact: true })).toBeVisible();
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
      return Promise.resolve({
        status: "saved",
        move: input.move,
        confirmationCleared: true,
      });
    },
    discard: (input) => {
      discarded.push(input);
      return Promise.resolve({ status: "discarded", move: input.move });
    },
  });

  await expect
    .element(page.getByRole("region", { name: formatCalendarDate("2026-11-13") }))
    .toBeVisible();
  await expect
    .element(
      page.getByText(`${scheduledRunLine("2026-11-13", nextRunAt)}.`, { exact: true }).first(),
    )
    .toBeVisible();
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
        `Saved for ${formatCalendarDate("2026-11-17")}. Your earlier confirmation was cleared, so confirm the move again when it is due.`,
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
    .element(page.getByRole("button", { name: /Confirm group and run now: Drop Riley Chen/u }))
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

it("shows a group as one card that lists every move and confirms once", async () => {
  await page.viewport(1280, 900);
  const group = "018f79ea-7d86-7c18-9b4a-8b4d0c9165e1";
  const drop = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d1",
    team: alpha,
    group,
    kind: "drop",
    drops: [player("Riley Chen")],
  });
  const stash = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d2",
    team: alpha,
    group,
    kind: "stash",
    drops: [],
    intent: { kind: "stash", player: player("Amon-Ra St. Brown") },
  });
  const confirmed: Array<TransactionConfirmRequest> = [];
  using _app = setupTransactionsPage({
    open: listData(
      [drop, stash],
      { open: 2, today: 2, saved: 0, ended: 0 },
      [],
      [
        {
          group,
          team: alpha.id,
          label: "Weekend moves",
          status: "ready",
          moves: [stash.move, drop.move],
          actions: [],
          notRun: [],
          detail:
            "This group is ready to run whole, in this order: Drop Riley Chen, Stash Amon-Ra St. Brown.",
        },
      ],
    ),
    confirm: (input) => {
      confirmed.push(input);
      return Promise.resolve({
        status: "confirmed",
        confirmed: input.moves,
        counts: { moves: 2, executed: 2, pending: 0, failed: 0, skipped: 0, unknown: 0 },
        refusals: [],
      });
    },
  });

  await expect.element(page.getByText("Weekend moves", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Drop Riley Chen", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Stash Amon-Ra St. Brown", { exact: true })).toBeVisible();
  expect(page.getByRole("button", { name: /Confirm group and run now:/u }).elements()).toHaveLength(
    1,
  );

  await page.getByRole("button", { name: "Confirm group and run now: Weekend moves" }).click();

  await expect.element(page.getByText("Confirmed and ran 2 moves.", { exact: true })).toBeVisible();
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]?.moves).toStrictEqual([drop.move, stash.move]);
});

it("names the immediate run beside the action that confirms a group", async () => {
  await page.viewport(1280, 900);
  const group = "018f79ea-7d86-7c18-9b4a-8b4d0c9165e1";
  const drop = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d1",
    team: alpha,
    group,
    kind: "drop",
    drops: [player("Riley Chen")],
  });
  const stash = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d2",
    team: alpha,
    group,
    kind: "stash",
    drops: [],
    intent: { kind: "stash", player: player("Amon-Ra St. Brown") },
  });
  using _app = setupTransactionsPage({
    open: listData(
      [drop, stash],
      { open: 2, today: 2, saved: 0, ended: 0 },
      [],
      [
        {
          group,
          team: alpha.id,
          label: "Weekend moves",
          status: "ready",
          moves: [drop.move, stash.move],
          actions: [],
          notRun: [],
          detail:
            "This group is ready to run whole, in this order: Drop Riley Chen, Stash Amon-Ra St. Brown.",
        },
      ],
    ),
  });

  await expect.element(page.getByText("Runs immediately.", { exact: true })).toBeVisible();
  expect(page.getByRole("button", { name: /Confirm group and run now:/u }).elements()).toHaveLength(
    1,
  );
});

it("shows the fixes that make room inside the group they run with", async () => {
  await page.viewport(1280, 900);
  const fixGroup = "roster-fixes:018f79ea-7d86-7c18-9b4a-8b4d0c9165e3";
  const add = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165e3",
    team: alpha,
    kind: "free_agent_add",
    adds: [player("Jordan Lee")],
    drops: [],
  });
  const stash = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165e4",
    team: alpha,
    group: fixGroup,
    position: -1,
    kind: "stash",
    drops: [],
    intent: { kind: "stash", player: player("Amon-Ra St. Brown") },
  });
  const confirmed: Array<TransactionConfirmRequest> = [];
  using _app = setupTransactionsPage({
    open: listData(
      [stash, add],
      { open: 2, today: 2, saved: 0, ended: 0 },
      [],
      [
        {
          group: fixGroup,
          team: alpha.id,
          label: "Roster fixes",
          fixesFor: add.move,
          status: "ready",
          moves: [stash.move],
          actions: [],
          notRun: [],
          detail: "This group is ready to run whole, in this order: Stash Amon-Ra St. Brown.",
        },
      ],
    ),
    confirm: (input) => {
      confirmed.push(input);
      return Promise.resolve({
        status: "confirmed",
        confirmed: input.moves,
        counts: { moves: 2, executed: 2, pending: 0, failed: 0, skipped: 0, unknown: 0 },
        refusals: [],
      });
    },
  });

  await expect.element(page.getByText("Add Jordan Lee", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText("Added by the server so the add fits. You can edit or discard it.", {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect.element(page.getByText("Stash Amon-Ra St. Brown", { exact: true })).toBeVisible();
  expect(page.getByRole("button", { name: /Confirm group and run now:/u }).elements()).toHaveLength(
    1,
  );

  await page.getByRole("button", { name: "Confirm group and run now: Add Jordan Lee" }).click();
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]?.moves).toStrictEqual([add.move, stash.move]);
});

it("leaves a partly run group without a discard action and folds its explanation", async () => {
  await page.viewport(1280, 900);
  const group = "018f79ea-7d86-7c18-9b4a-8b4d0c9165d1";
  const drop = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d2",
    team: alpha,
    group,
    kind: "drop",
    decision: "now",
    drops: [player("Riley Chen")],
    confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" },
    runAt: "2026-11-11T18:05:00.000Z",
    runDecidedBy: "owner",
    result: "executed",
  });
  const stash = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d3",
    team: alpha,
    group,
    kind: "stash",
    position: 1,
    decision: "now",
    drops: [],
    intent: { kind: "stash", player: player("Amon-Ra St. Brown") },
    result: "failed",
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
          group,
          team: alpha.id,
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

  await expect.element(page.getByText("Partly ran", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText("1 of 2 moves ran: Drop Riley Chen ran; Stash Amon-Ra St. Brown failed.", {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect.element(page.getByText("Ran when you confirmed", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Failed", { exact: true })).toBeVisible();
  expect(page.getByRole("button", { name: /Discard:/u }).elements()).toHaveLength(0);
  expect(page.getByRole("button", { name: /Confirm group/u }).elements()).toHaveLength(0);
  await expect.element(page.getByText(sentence, { exact: true })).not.toBeVisible();

  await page.getByText("Why these moves", { exact: true }).click();
  await expect.element(page.getByText(sentence, { exact: true })).toBeVisible();
});

it("reads a discarded move as discarded, not failed", async () => {
  await page.viewport(1280, 900);
  const discarded = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d4",
    team: beta,
    kind: "drop",
    decision: "discarded",
    decidedAt: "2026-11-10T15:10:00.000Z",
    drops: [player("Tyler Boyd")],
    result: "failed",
  });
  using _app = setupTransactionsPage({
    open: listData([], { open: 0, today: 0, saved: 0, ended: 1 }),
    ended: listData([discarded], { open: 0, today: 0, saved: 0, ended: 1 }),
  });

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByText("Discarded", { exact: true })).toBeVisible();
  expect(page.getByText("Failed", { exact: true }).elements()).toHaveLength(0);
  await expect.element(page.getByText(discardLine(discarded) ?? "", { exact: true })).toBeVisible();
});

it("labels a move that ran on confirmation as ran when you confirmed", async () => {
  await page.viewport(1280, 900);
  const ran = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d5",
    team: alpha,
    kind: "drop",
    decision: "now",
    drops: [player("Riley Chen")],
    confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" },
    runAt: "2026-11-11T18:05:00.000Z",
    runDecidedBy: "owner",
    result: "executed",
  });
  using _app = setupTransactionsPage({
    open: listData([], { open: 0, today: 0, saved: 0, ended: 1 }),
    ended: listData([ran], { open: 0, today: 0, saved: 0, ended: 1 }),
  });

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByText("Ran when you confirmed", { exact: true })).toBeVisible();
  expect(page.getByText("Ran now", { exact: true }).elements()).toHaveLength(0);
});

it("renders a confirmation timestamp in the reader's local date and time", async () => {
  await page.viewport(1280, 900);
  const ran = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d6",
    team: alpha,
    kind: "drop",
    decision: "now",
    drops: [player("Riley Chen")],
    confirmation: { by: "owner", at: "2026-11-05T22:32:00.000Z" },
    runAt: "2026-11-06T00:05:00.000Z",
    runDecidedBy: "owner",
    result: "executed",
  });
  using _app = setupTransactionsPage({
    open: listData([], { open: 0, today: 0, saved: 0, ended: 1 }),
    ended: listData([ran], { open: 0, today: 0, saved: 0, ended: 1 }),
  });

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  const line = confirmationLine(ran) ?? "";
  await expect.element(page.getByText(line, { exact: true })).toBeVisible();
  expect(line).toContain(" at ");
  expect(page.getByText(line, { exact: true }).element().textContent).toContain(
    new Intl.DateTimeFormat(undefined, { month: "short" }).format(
      new Date(ran.confirmation?.at ?? ""),
    ),
  );
});

it("keeps the confirmation line apart from the run time", async () => {
  await page.viewport(1280, 900);
  const ran = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d7",
    team: alpha,
    kind: "drop",
    decision: "now",
    drops: [player("Riley Chen")],
    confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" },
    runAt: "2026-11-11T18:05:00.000Z",
    runDecidedBy: "owner",
    result: "executed",
  });
  using _app = setupTransactionsPage({
    open: listData([], { open: 0, today: 0, saved: 0, ended: 1 }),
    ended: listData([ran], { open: 0, today: 0, saved: 0, ended: 1 }),
  });

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  const confirmation = page.getByText(confirmationLine(ran) ?? "", { exact: true });
  await expect.element(confirmation).toBeVisible();
  await expect.element(page.getByText("Ran when you confirmed", { exact: true })).toBeVisible();
  const runClock = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ran.runAt ?? ""));
  expect(confirmation.element().textContent).not.toContain(runClock);
});

it("names the league's next run while a waiver waits", async () => {
  await page.viewport(1280, 900);
  const waiting = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d8",
    team: alpha,
    kind: "waiver_claim",
    decision: "now",
    adds: [player("Amon-Ra St. Brown")],
    drops: [player("Romeo Doubs")],
    confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" },
    result: "pending",
  });
  using _app = setupTransactionsPage({
    open: listData([waiting], { open: 1, today: 1, saved: 0, ended: 0 }),
  });

  await expect.element(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Waiting", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText(waitingOnLeagueLine(nextRunAt), { exact: true }))
    .toBeVisible();
});

it("shows earlier moves newest first and loads the next older page", async () => {
  await page.viewport(1280, 900);
  const counts = { open: 0, today: 0, saved: 0, ended: 3 };
  const newest = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165e1",
    team: alpha,
    decision: "now",
    runDay: "2026-11-16",
    drops: [player("Riley Chen")],
    result: "executed",
    runDecidedBy: "system",
  });
  const older = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165e2",
    team: alpha,
    decision: "now",
    runDay: "2026-11-15",
    drops: [player("Jordan Lee")],
    result: "executed",
    runDecidedBy: "system",
  });
  const oldest = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165e3",
    team: alpha,
    decision: "now",
    runDay: "2026-11-14",
    drops: [player("Tyler Boyd")],
    result: "executed",
    runDecidedBy: "system",
  });
  const first = {
    ...listData([newest, older], counts),
    page: {
      returned: 2,
      complete: false,
      next: {
        runDay: older.runDay ?? null,
        team: older.team.id,
        position: older.position,
        move: older.move,
      },
    },
  };
  using _app = setupTransactionsPage({
    open: listData([], counts),
    endedPages: [first, listData([oldest], counts)],
  });

  await expect.element(page.getByText("3 ended moves", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show earlier moves" }).click();

  const newestRow = page.getByText("Drop Riley Chen", { exact: true });
  const olderRow = page.getByText("Drop Jordan Lee", { exact: true });
  await expect.element(newestRow).toBeVisible();
  await expect.element(olderRow).toBeVisible();
  expect(
    newestRow.element().compareDocumentPosition(olderRow.element()) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  await page.getByRole("button", { name: "Load more" }).click();
  const oldestRow = page.getByText("Drop Tyler Boyd", { exact: true });
  await expect.element(oldestRow).toBeVisible();
  expect(
    olderRow.element().compareDocumentPosition(oldestRow.element()) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(page.getByRole("button", { name: "Load more" }).elements()).toHaveLength(0);
});

it("confirms groups on two teams at the same time with per team progress", async () => {
  await page.viewport(1280, 900);
  const alphaMove = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165f1",
    team: alpha,
    kind: "drop",
    drops: [player("Riley Chen")],
  });
  const betaMove = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165f2",
    team: beta,
    kind: "free_agent_add",
    adds: [player("Jordan Lee")],
    drops: [],
  });
  const alphaConfirm = Promise.withResolvers<TransactionMoveConfirmationData>();
  const betaConfirm = Promise.withResolvers<TransactionMoveConfirmationData>();
  const confirmed: Array<TransactionConfirmRequest> = [];
  using _app = setupTransactionsPage({
    open: listData([alphaMove, betaMove], { open: 2, today: 2, saved: 0, ended: 0 }),
    confirm: (input) => {
      confirmed.push(input);
      return input.team === alpha.id ? alphaConfirm.promise : betaConfirm.promise;
    },
  });

  const alphaButton = page.getByRole("button", {
    name: "Confirm group and run now: Drop Riley Chen",
  });
  const betaButton = page.getByRole("button", {
    name: "Confirm group and run now: Add Jordan Lee",
  });
  await alphaButton.click();
  await betaButton.click();

  await expect.poll(() => confirmed.length).toBe(2);
  await expect.element(alphaButton).toHaveAttribute("aria-busy", "true");
  await expect.element(betaButton).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => page.getByText("Running", { exact: true }).elements().length).toBe(2);
  expect(confirmed.map((entry) => entry.team).sort()).toStrictEqual([alpha.id, beta.id]);

  alphaConfirm.resolve({
    status: "confirmed",
    confirmed: [alphaMove.move],
    counts: { moves: 1, executed: 1, pending: 0, failed: 0, skipped: 0, unknown: 0 },
    refusals: [],
  });
  await expect.element(alphaButton).not.toHaveAttribute("aria-busy", "true");
  await expect.element(betaButton).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => page.getByText("Running", { exact: true }).elements().length).toBe(1);

  betaConfirm.resolve({
    status: "confirmed",
    confirmed: [betaMove.move],
    counts: { moves: 1, executed: 1, pending: 0, failed: 0, skipped: 0, unknown: 0 },
    refusals: [],
  });
  await expect.element(betaButton).not.toHaveAttribute("aria-busy", "true");
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
      .element(page.getByRole("button", { name: /Confirm group and run now: Drop Riley Chen/u }))
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
  readonly endedPages?: ReadonlyArray<TransactionMoveListData>;
}): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  const open =
    options.teamCount === undefined
      ? options.open
      : { ...options.open, teamCount: options.teamCount };
  const emptyEnded = listData([], { open: 0, today: 0, saved: 0, ended: 0 });
  const endedPages = options.endedPages ?? [options.ended ?? emptyEnded];
  const remote: TransactionRemote = {
    timeline: () =>
      options.failure === undefined ? Promise.resolve(open) : Promise.reject(options.failure),
    list: (input) => {
      if (input.state !== "ended") {
        return Promise.resolve(open);
      }
      const page = input.after === undefined ? endedPages[0] : endedPages[1];
      return Promise.resolve(page ?? emptyEnded);
    },
    plan: () =>
      Promise.resolve({
        team: alpha,
        nextRunAt,
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
      pages: [endedPages[0] ?? emptyEnded],
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
    nextRunAt,
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
