import { EffectArray } from "@lineupkeep/collections";
import { EffectString } from "@lineupkeep/collections";
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

import "#web/styles.css";

import { expect, it } from "vitest";
import { page } from "vitest/browser";

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
import { discardLine, plannedMoment, resultDetailLine, submittedLine } from "./transactionTimes.ts";

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
const nextCheckAt = "2026-11-11T21:55:00.000Z";
const sendsAt = "2026-11-13T21:55:00.000Z";

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
    effectiveDate: "2026-11-15",
    sendsAt: "2026-11-14T08:55:00.000Z",
    adds: [player("Tank Bigsby")],
    drops: [player("Tyler Boyd")],
    reason: "Cover the bench for a bye.",
  });
  using _app = setupTransactionsPage({
    open: listData([drop, add, savedWaiver, savedAdd], { open: 4, today: 2, saved: 2, ended: 0 }),
  });

  await expect.element(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
  await expect
    .element(page.getByText("4 open moves · 2 today · 2 later", { exact: true }))
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
    .element(
      page.getByText(
        `Runs ${plannedMoment("2026-11-14T08:55:00.000Z")} if you confirm. Takes effect ${formatCalendarDate("2026-11-15")}.`,
        { exact: true },
      ),
    )
    .toBeVisible();
  expect(
    page.getByText(`Takes effect ${formatCalendarDate("2026-11-13")}.`, { exact: true }).elements(),
  ).toHaveLength(0);
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

it("carries a failed move's refusal as the one status's next action", async () => {
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
  expect(page.getByText("Failed", { exact: true }).elements()).toHaveLength(1);
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
    .element(page.getByText("Riley Chen is not on the roster.", { exact: true }))
    .toBeVisible();
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

it("runs today's move now and returns the recorded outcome", async () => {
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

  await expect
    .element(page.getByText(/2 moves need your decision before they can run/u))
    .toBeVisible();

  await page.getByRole("button", { name: /Run now: Drop Riley Chen/u }).click();

  await expect.element(page.getByText("Ran 1 move.", { exact: true })).toBeVisible();
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]?.team).toBe(alpha.id);
  expect(confirmed[0]?.moves).toStrictEqual([first.move]);
  expect(confirmed[0]?.key.length).toBeGreaterThan(0);
});

it("schedules a saved move for its day without running it", async () => {
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

  const schedule = page.getByRole("button", {
    name: /^Schedule for .+: Claim Amon-Ra St\. Brown/u,
  });
  await expect.element(schedule).toBeVisible();
  expect(schedule.element().closest("[data-card-footer]")?.textContent).toContain(
    `Schedule for ${formatCalendarDate("2026-11-13")}`,
  );
  expect(
    schedule.element().closest("[data-card-footer]")?.querySelector("[aria-label^='Discard']"),
  ).not.toBeNull();
  await schedule.click();

  await expect
    .element(
      page.getByText(`Scheduled 1 move to send on ${formatCalendarDate("2026-11-13")}.`, {
        exact: true,
      }),
    )
    .toBeVisible();
  expect(confirmed[0]?.moves).toStrictEqual([saved.move]);
});

it("runs a next-day move now and says when it takes effect", async () => {
  await page.viewport(1280, 900);
  const waiting = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c4",
    team: alpha,
    kind: "drop",
    drops: [player("Anton Frondell")],
    reason: "Open a bench place for the activate.",
    runDay: today,
    effectiveDate: "2026-11-12",
  });
  using _app = setupTransactionsPage({
    open: listData([waiting], { open: 1, today: 1, saved: 0, ended: 0 }),
  });

  await expect
    .element(
      page.getByText(`Runs when you confirm. Takes effect ${formatCalendarDate("2026-11-12")}.`, {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Run now: Drop Anton Frondell" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Schedule instead: Drop Anton Frondell" }))
    .toBeVisible();
});

it("moves scheduling into the card footer with one primary action", async () => {
  await page.viewport(1280, 900);
  const waiting = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c3",
    team: alpha,
    kind: "drop",
    drops: [player("Anton Frondell")],
    reason: "Open a bench place for the activate.",
    runDay: today,
    effectiveDate: "2026-11-12",
  });
  using _app = setupTransactionsPage({
    open: listData([waiting], { open: 1, today: 1, saved: 0, ended: 0 }),
  });

  await expect
    .element(page.getByRole("button", { name: "Run now: Drop Anton Frondell" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Schedule instead: Drop Anton Frondell" }))
    .toBeVisible();
  const runNow = page
    .getByRole("button", { name: "Run now: Drop Anton Frondell" })
    .element()
    .getBoundingClientRect();
  const schedule = page
    .getByRole("button", { name: "Schedule instead: Drop Anton Frondell" })
    .element()
    .getBoundingClientRect();
  expect(schedule.x).toBeLessThan(runNow.x);

  await page.getByRole("button", { name: "Schedule instead: Drop Anton Frondell" }).click();
  await expect.element(page.getByLabelText("Day to run")).toBeVisible();
  expect(
    page.getByRole("button", { name: "Run now: Drop Anton Frondell" }).elements(),
  ).toHaveLength(0);
  expect(
    page.getByRole("button", { name: "Schedule instead: Drop Anton Frondell" }).elements(),
  ).toHaveLength(0);
  expect(page.getByRole("button", { name: /Discard:/u }).elements()).toHaveLength(0);
  const cancel = page.getByRole("button", { name: "Cancel" }).element().getBoundingClientRect();
  const save = page
    .getByRole("button", { name: "Save schedule" })
    .element()
    .getBoundingClientRect();
  expect(cancel.x).toBeLessThan(save.x);
});

it("says needs your decision, scheduled for a day, and ran in plain words", async () => {
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
    kind: "free_agent_add",
    decision: "confirmed",
    runDay: "2026-11-13",
    effectiveDate: "2026-11-14",
    sendsAt,
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
    open: listData([pending, confirmed], { open: 2, today: 1, saved: 1, ended: 1 }),
    ended: listData([discarded, ran], { open: 0, today: 0, saved: 0, ended: 1 }),
  });

  await expect
    .element(page.getByText("Needs your decision", { exact: true }).first())
    .toBeVisible();
  await expect
    .element(page.getByText(`Scheduled to run ${plannedMoment(sendsAt)}`, { exact: true }).first())
    .toBeVisible();
  await expect
    .element(page.getByText(submittedLine(confirmed) ?? "", { exact: true }))
    .toBeVisible();

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByRole("img", { name: "Ran on schedule" })).toBeVisible();
  await expect
    .element(page.getByText(submittedLine(ran) ?? "", { exact: true }).first())
    .toBeVisible();
  expect(page.getByRole("img", { name: "Discarded" }).elements()).toHaveLength(0);
  expect(page.getByText(discardLine(discarded) ?? "", { exact: true }).elements()).toHaveLength(0);
});

it("keeps a discarded move out of earlier", async () => {
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
    open: listData([], { open: 0, today: 0, saved: 0, ended: 0 }),
    ended: listData([discarded], { open: 0, today: 0, saved: 0, ended: 0 }),
  });

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByText("No earlier moves", { exact: true })).toBeVisible();
  expect(page.getByText(discardLine(discarded) ?? "", { exact: true }).elements()).toHaveLength(0);
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
  expect(page.getByRole("button", { name: /Change date:/u }).elements()).toHaveLength(2);
  expect(page.getByRole("button", { name: /Discard:/u }).elements()).toHaveLength(2);

  await page.getByRole("button", { name: /Change date: Drop Riley Chen/u }).click();
  await expect
    .element(
      page.getByText(
        "Lineupgrade sends the move on the day you pick, and your league decides when it applies. Saving clears your decision.",
        { exact: true },
      ),
    )
    .toBeVisible();
  expect(page.getByRole("button", { name: "Run now" }).elements()).toHaveLength(0);
  expect(page.getByRole("button", { name: "Schedule" }).elements()).toHaveLength(0);
  expect(page.getByRole("button", { name: /Discard:/u }).elements()).toHaveLength(1);
  const date = page.getByLabelText("Day to run");
  await expect.element(date).toHaveValue("2026-11-13");
  await date.fill("2026-11-17");
  await page.getByRole("button", { name: "Save schedule" }).click();

  await expect
    .element(
      page.getByText(
        `Saved for ${formatCalendarDate("2026-11-17")}. Your earlier decision was cleared, so choose the move again when it is due.`,
        { exact: true },
      ),
    )
    .toBeVisible();
  expect(saved).toStrictEqual([{ team: alpha.id, move: first.move, runDay: "2026-11-17" }]);
  expect(page.getByLabelText("Day to run").elements()).toHaveLength(0);

  await page.getByRole("button", { name: /Discard: Add Jordan Lee/u }).click();
  await expect.element(page.getByText("Discarded 1 move.", { exact: true })).toBeVisible();
  expect(discarded).toStrictEqual([{ team: alpha.id, move: second.move }]);
});

it("blocks a move that cannot run and leaves its reason beside the discard action", async () => {
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
  expect(page.getByRole("button", { name: /Run now:/u }).elements()).toHaveLength(0);
  const staleCard = page
    .getByText("Riley Chen is no longer on this team's roster, so there is nothing to drop.", {
      exact: true,
    })
    .element()
    .closest<HTMLElement>("[data-card]");
  expect(
    staleCard?.querySelector<HTMLButtonElement>("[data-card-footer] [aria-label^='Discard']")
      ?.disabled,
  ).toBe(false);
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
  const savedCard = page
    .getByText("Jordan Lee is on waivers, so a free-agent add cannot bring them in.", {
      exact: true,
    })
    .element()
    .closest<HTMLElement>("[data-card]");
  expect(
    savedCard?.querySelector<HTMLButtonElement>("[data-card-footer] [aria-label^='Discard']")
      ?.disabled,
  ).toBe(false);
});

it("loads with one moving mark instead of placeholder cards", async () => {
  const pending = Promise.withResolvers<TransactionMoveListData>();
  using _app = setupTransactionsPage({
    open: listData([], { open: 0, today: 0, saved: 0, ended: 0 }),
    timeline: () => pending.promise,
  });

  const loading = page.getByLabelText("Loading moves");
  await expect.element(loading).toBeVisible();
  expect(page.getByRole("heading", { name: "Today", exact: true }).elements()).toHaveLength(0);
  expect(page.getByRole("heading", { name: "Earlier", exact: true }).elements()).toHaveLength(0);
  expect(page.getByText(/open moves/u).elements()).toHaveLength(0);
  expect(loading.getByRole("listitem").elements()).toHaveLength(0);
  expect(loading.element().querySelectorAll(".animate-loading-slide")).toHaveLength(1);

  pending.resolve(listData([], { open: 0, today: 0, saved: 0, ended: 0 }));
  await expect.element(page.getByText("Nothing needs you today", { exact: true })).toBeVisible();
});

it("shows clear teams when nothing is open", async () => {
  using _clear = setupTransactionsPage({
    open: listData([], { open: 0, today: 0, saved: 0, ended: 0 }),
    teamCount: 5,
  });

  await expect.element(page.getByText(/0 open moves/u).first()).toBeVisible();
  await expect.element(page.getByText("Nothing for today", { exact: true }).first()).toBeVisible();
  await expect.element(page.getByText("Nothing scheduled", { exact: true })).toBeVisible();
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

it("shows a group as one card that lists every move and runs once", async () => {
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
  expect(page.getByRole("button", { name: /Run now:/u }).elements()).toHaveLength(1);

  await page.getByRole("button", { name: "Run now: Weekend moves" }).click();

  await expect.element(page.getByText("Ran 2 moves.", { exact: true })).toBeVisible();
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]?.moves).toStrictEqual([drop.move, stash.move]);
});

it("frames a transaction group with the shared card structure", async () => {
  await page.viewport(1280, 900);
  const only = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d1",
    team: alpha,
    kind: "drop",
    drops: [player("Riley Chen")],
  });
  using _app = setupTransactionsPage({
    open: listData([only], { open: 1, today: 1, saved: 0, ended: 0 }),
  });

  const heading = page.getByRole("heading", { name: "Alpha", exact: true });
  await expect.element(heading).toBeVisible();
  const card = heading.element().closest<HTMLElement>("[data-card]");
  expect(card, "a transaction group uses the shared frame").not.toBeNull();
  if (card === null) {
    return;
  }

  expect(getComputedStyle(card).borderTopWidth).toBe("2px");
  expect(getComputedStyle(card).boxShadow).toBe("none");
  const list = card.parentElement;
  expect(list, "the group card list").not.toBeNull();
  expect(Number.parseFloat(getComputedStyle(list ?? card).rowGap)).toBeGreaterThanOrEqual(24);
  for (const part of ["header", "meta", "body", "footer"]) {
    expect(card.querySelector(`[data-card-${part}]`), `the ${part} slot`).not.toBeNull();
  }
  expect(card.querySelector("[data-card-header] [data-card-badge]")?.textContent).toBe(
    "Needs your decision",
  );
  const cardFooter = card.querySelector("[data-card-footer]")?.textContent;
  expect(cardFooter).toContain("Run now");
  expect(cardFooter).toContain("Schedule");
  expect(
    card.querySelector("[data-card-footer]")?.querySelector("[aria-label^='Discard']"),
  ).not.toBeNull();
});

it("names today's run now without a separate run note", async () => {
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

  await expect.element(page.getByRole("button", { name: "Run now: Weekend moves" })).toBeVisible();
  const footerText = page
    .getByRole("button", { name: "Run now: Weekend moves" })
    .element()
    .closest("[data-card-footer]")?.textContent;
  expect(footerText).toContain("Run now");
  expect(footerText).toContain("Schedule");
  expect(page.getByText("Runs immediately.").elements()).toHaveLength(0);
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
      page.getByText("Added by Lineupgrade to make room for the add.", {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect.element(page.getByText("Stash Amon-Ra St. Brown", { exact: true })).toBeVisible();
  expect(page.getByRole("button", { name: /Run now:/u }).elements()).toHaveLength(1);

  await page.getByRole("button", { name: "Run now: Add Jordan Lee" }).click();
  expect(confirmed).toHaveLength(1);
  expect(confirmed[0]?.moves).toStrictEqual([add.move, stash.move]);
});

it("leaves a partly run group without a run action and folds its explanation", async () => {
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
  const discarded: Array<Parameters<TransactionRemote["discardGroup"]>[0]> = [];
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
    discardGroup: (input) => {
      discarded.push(input);
      return Promise.resolve({ status: "discarded", move: input.move });
    },
  });

  await expect.element(page.getByText("Partly ran", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText("Check your roster, then choose the move again or discard it.", {
        exact: true,
      }),
    )
    .toBeVisible();
  expect(page.getByRole("button", { name: /Discard:/u }).elements()).toHaveLength(0);
  expect(page.getByRole("button", { name: /Run now/u }).elements()).toHaveLength(0);
  expect(page.getByRole("button", { name: /Retry:/u }).elements()).toHaveLength(0);
  expect(page.getByText("Partly ran", { exact: true }).elements()).toHaveLength(1);
  await expect.element(page.getByText(sentence, { exact: true })).not.toBeVisible();

  await page.getByRole("button", { name: "Discard remaining: Group of 2 moves" }).click();
  await expect
    .element(page.getByText("Discarded what was left of this group.", { exact: true }))
    .toBeVisible();
  expect(discarded).toStrictEqual([{ team: alpha.id, move: drop.move }]);

  await page.getByText("Why these moves", { exact: true }).click();
  await expect.element(page.getByText(sentence, { exact: true })).toBeVisible();
});

it("keeps a discarded move out of earlier even when it failed", async () => {
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
    open: listData([], { open: 0, today: 0, saved: 0, ended: 0 }),
    ended: listData([discarded], { open: 0, today: 0, saved: 0, ended: 0 }),
  });

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByText("No earlier moves", { exact: true })).toBeVisible();
  expect(page.getByRole("img", { name: "Failed" }).elements()).toHaveLength(0);
  expect(page.getByText(discardLine(discarded) ?? "", { exact: true }).elements()).toHaveLength(0);
});

it("labels a move that ran after you submitted as ran after you submitted", async () => {
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
    effectiveDate: "2026-11-12",
    result: "executed",
  });
  using _app = setupTransactionsPage({
    open: listData([], { open: 0, today: 0, saved: 0, ended: 1 }),
    ended: listData([ran], { open: 0, today: 0, saved: 0, ended: 1 }),
  });

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByRole("img", { name: "Ran immediately" })).toBeVisible();
  await expect.element(page.getByText("Took effect November 12.", { exact: true })).toBeVisible();
  expect(page.getByText("Ran now", { exact: true }).elements()).toHaveLength(0);
});

it("renders a submission timestamp in the reader's local date and time", async () => {
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
  const line = submittedLine(ran) ?? "";
  await expect.element(page.getByText(line, { exact: true })).toBeVisible();
  expect(line).toMatch(/^You submitted this on .+ at .+\.$/u);
});

it("keeps the submission line apart from the run time", async () => {
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
  const submission = page.getByText(submittedLine(ran) ?? "", { exact: true });
  await expect.element(submission).toBeVisible();
  await expect.element(page.getByRole("img", { name: "Ran immediately" })).toBeVisible();
  const runClock = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ran.runAt ?? ""));
  expect(submission.element().textContent).not.toContain(runClock);
});

it("moves a submitted group with a pending waiver into earlier, not today", async () => {
  await page.viewport(1280, 900);
  const group = "018f79ea-7d86-7c18-9b4a-8b4d0c9165e9";
  const claim = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d8",
    team: alpha,
    group,
    kind: "waiver_claim",
    decision: "now",
    phase: "with_league",
    adds: [player("Amon-Ra St. Brown")],
    drops: [player("Romeo Doubs")],
    confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" },
    result: "pending",
  });
  const stash = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d9",
    team: alpha,
    group,
    position: 1,
    kind: "waiver_claim",
    phase: "with_league",
    adds: [player("Tank Bigsby")],
    drops: [],
    decision: "now",
    confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" },
    result: "pending",
  });
  using _app = setupTransactionsPage({
    open: listData(
      [claim, stash],
      { open: 2, today: 2, saved: 0, ended: 0 },
      [],
      [
        {
          group,
          team: alpha.id,
          label: "Weekend moves",
          status: "blocked",
          moves: [claim.move, stash.move],
          actions: [],
          notRun: [],
          detail: "This group does not run.",
        },
      ],
    ),
  });

  await expect.element(page.getByText(/· 0 today · 0 later/u)).toBeVisible();
  await expect.element(page.getByText("Nothing for today", { exact: true }).first()).toBeVisible();
  expect(
    page
      .getByRole("region", { name: "Today" })
      .getByText("With the league", { exact: true })
      .elements(),
  ).toHaveLength(0);
  await expect.element(page.getByText("2 moves", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByText("With the league", { exact: true })).toBeVisible();
  expect(page.getByText("With the league", { exact: true }).elements()).toHaveLength(1);
  await expect.element(page.getByText("Weekend moves", { exact: true })).toBeVisible();
  await expect.element(page.getByText(submittedLine(claim) ?? "", { exact: true })).toBeVisible();
  expect(page.getByText("Waiting on the league until", { exact: false }).elements()).toHaveLength(
    0,
  );
  expect(page.getByText("This group does not run.", { exact: true }).elements()).toHaveLength(0);
});

it("keeps a submitted claim with the league and shows no hourly run time", async () => {
  await page.viewport(1280, 900);
  const claim = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165dc",
    team: alpha,
    kind: "waiver_claim",
    decision: "now",
    phase: "with_league",
    adds: [player("Amon-Ra St. Brown")],
    drops: [player("Romeo Doubs")],
    confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" },
    result: "pending",
    attempts: [
      {
        kind: "claim",
        player: player("Amon-Ra St. Brown"),
        outcome: "pending",
        reason: "The league will process this claim.",
        at: now,
      },
    ],
  });
  using _app = setupTransactionsPage({
    open: listData([], { open: 0, today: 0, saved: 0, ended: 1 }),
    ended: listData([claim], { open: 0, today: 0, saved: 0, ended: 1 }, [
      {
        team: alpha.id,
        places: { used: 1, maximum: 4, free: 3 },
        reserve: [],
        waiver: { rule: "gametime" },
      },
    ]),
  });

  await expect.element(page.getByText(/0 open moves/u).first()).toBeVisible();
  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByRole("img", { name: "With the league" })).toBeVisible();
  await expect
    .element(page.getByText("Your league's waiver rule: gametime.", { exact: true }))
    .toBeVisible();
  expect(page.getByRole("img", { name: "Waiting for the league" }).elements()).toHaveLength(0);
  expect(page.getByText("Scheduled to run", { exact: false }).elements()).toHaveLength(0);
});

it("shows one status on a blocked card and the action that clears it", async () => {
  await page.viewport(1280, 900);
  const group = "018f79ea-7d86-7c18-9b4a-8b4d0c9165e8";
  const drop = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165d8",
    team: alpha,
    group,
    kind: "drop",
    decision: "now",
    drops: [player("Riley Chen")],
  });
  using _app = setupTransactionsPage({
    open: listData(
      [drop],
      { open: 1, today: 1, saved: 0, ended: 0 },
      [],
      [
        {
          group,
          team: alpha.id,
          status: "blocked",
          moves: [drop.move],
          actions: [],
          notRun: [],
          detail: "This group does not run.",
          cure: "Check your roster, then choose the move again or discard it.",
        },
      ],
    ),
  });

  await expect.element(page.getByText("Blocked", { exact: true })).toBeVisible();
  expect(page.getByText("Blocked", { exact: true }).elements()).toHaveLength(1);
  await expect
    .element(
      page.getByText("Check your roster, then choose the move again or discard it.", {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect
    .element(page.getByText("This group does not run.", { exact: true }))
    .not.toBeVisible();
  expect(page.getByRole("button", { name: /Run now/u }).elements()).toHaveLength(0);
  const blockedCard = page
    .getByText("Check your roster, then choose the move again or discard it.", { exact: true })
    .element()
    .closest<HTMLElement>("[data-card]");
  expect(
    blockedCard?.querySelector<HTMLButtonElement>("[data-card-footer] [aria-label^='Discard']")
      ?.disabled,
  ).toBe(false);
});

it("never says confirmed in the provenance of a submitted move", async () => {
  await page.viewport(1280, 900);
  const scheduled = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165da",
    team: alpha,
    kind: "waiver_claim",
    decision: "confirmed",
    runDay: "2026-11-13",
    adds: [player("Amon-Ra St. Brown")],
    drops: [player("Romeo Doubs")],
    confirmation: { by: "owner", at: "2026-11-11T17:35:00.000Z" },
  });
  using _app = setupTransactionsPage({
    open: listData([scheduled], { open: 1, today: 0, saved: 1, ended: 0 }),
  });

  const line = submittedLine(scheduled) ?? "";
  await expect.element(page.getByText(line, { exact: true })).toBeVisible();
  expect(EffectString.toLowerCase(line)).not.toContain("confirm");
  expect(EffectString.toLowerCase(document.body.textContent)).not.toContain("confirm");
});

it("starts the explanation closed and drops an agent's plan letter", async () => {
  await page.viewport(1280, 900);
  const drop = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165db",
    team: alpha,
    kind: "drop",
    drops: [player("Riley Chen")],
    reason: "11A: Open a bench place for the incoming receiver.",
  });
  using _app = setupTransactionsPage({
    open: listData([drop], { open: 1, today: 1, saved: 0, ended: 0 }),
  });

  await expect
    .element(page.getByText("Open a bench place for the incoming receiver.", { exact: true }))
    .not.toBeVisible();
  await page.getByText("Why these moves", { exact: true }).click();
  await expect
    .element(page.getByText("Open a bench place for the incoming receiver.", { exact: true }))
    .toBeVisible();
  expect(document.body.textContent).not.toContain("11A");
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

  await expect.element(page.getByText("3 moves", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show earlier moves" }).click();

  const newestRow = page.getByText("Drop Riley Chen", { exact: true });
  const olderRow = page.getByText("Drop Jordan Lee", { exact: true });
  await expect.element(newestRow).toBeVisible();
  await expect.element(olderRow).toBeVisible();
  expect(
    newestRow.element().compareDocumentPosition(olderRow.element()) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  await page.getByRole("button", { name: "Show more moves" }).click();
  const oldestRow = page.getByText("Drop Tyler Boyd", { exact: true });
  await expect.element(oldestRow).toBeVisible();
  expect(
    olderRow.element().compareDocumentPosition(oldestRow.element()) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(page.getByRole("button", { name: "Show more moves" }).elements()).toHaveLength(0);
});

it("runs groups on two teams at the same time with per team progress", async () => {
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
    name: "Run now: Drop Riley Chen",
  });
  const betaButton = page.getByRole("button", {
    name: "Run now: Add Jordan Lee",
  });
  await alphaButton.click();
  await betaButton.click();

  await expect.poll(() => confirmed.length).toBe(2);
  await expect.element(alphaButton).toHaveAttribute("aria-busy", "true");
  await expect.element(betaButton).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => page.getByText("Running", { exact: true }).elements().length).toBe(2);
  expect(EffectArray.map(confirmed, (entry) => entry.team).sort()).toStrictEqual([
    alpha.id,
    beta.id,
  ]);

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

it("starts every card on one team at once instead of locking the page", async () => {
  await page.viewport(1280, 900);
  const first = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165f3",
    team: alpha,
    kind: "drop",
    drops: [player("Riley Chen")],
  });
  const second = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165f4",
    team: alpha,
    kind: "free_agent_add",
    adds: [player("Jordan Lee")],
    drops: [],
  });
  const firstConfirm = Promise.withResolvers<TransactionMoveConfirmationData>();
  const secondConfirm = Promise.withResolvers<TransactionMoveConfirmationData>();
  const confirmed: Array<TransactionConfirmRequest> = [];
  using _app = setupTransactionsPage({
    open: listData([first, second], { open: 2, today: 2, saved: 0, ended: 0 }),
    confirm: (input) => {
      confirmed.push(input);
      return input.moves.includes(first.move) ? firstConfirm.promise : secondConfirm.promise;
    },
  });

  const firstButton = page.getByRole("button", { name: "Run now: Drop Riley Chen" });
  const secondButton = page.getByRole("button", { name: "Run now: Add Jordan Lee" });
  await firstButton.click();
  await secondButton.click();

  await expect.poll(() => confirmed.length).toBe(2);
  await expect.element(firstButton).toHaveAttribute("aria-busy", "true");
  await expect.element(secondButton).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => page.getByText("Running", { exact: true }).elements().length).toBe(2);

  firstConfirm.resolve({
    status: "confirmed",
    confirmed: [first.move],
    counts: { moves: 1, executed: 1, pending: 0, failed: 0, skipped: 0, unknown: 0 },
    refusals: [],
  });
  await expect.element(firstButton).not.toHaveAttribute("aria-busy", "true");
  await expect.element(secondButton).toHaveAttribute("aria-busy", "true");

  secondConfirm.resolve({
    status: "confirmed",
    confirmed: [second.move],
    counts: { moves: 1, executed: 1, pending: 0, failed: 0, skipped: 0, unknown: 0 },
    refusals: [],
  });
  await expect.element(secondButton).not.toHaveAttribute("aria-busy", "true");
});

it("keeps today's count and decision on a phone line", async () => {
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
      .element(page.getByRole("button", { name: /Run now: Drop Riley Chen/u }))
      .toBeEnabled();
    const root = document.documentElement;
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  } finally {
    await page.viewport(1280, 720);
    await page.viewport(1280, 900);
  }
});

it("offers the server's roster fixes on a card a roster fact blocks", async () => {
  await page.viewport(1280, 900);
  const add = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165f1",
    team: alpha,
    kind: "free_agent_add",
    adds: [player("Jordan Lee")],
    drops: [],
    validation: {
      status: "illegal",
      checkedAt: now,
      reasons: [
        {
          code: "roster_full",
          detail:
            "Add Jordan Lee needs a roster place, and this plan does not free one. Add a drop or a reserve move that frees a place, or remove this move.",
        },
      ],
    },
  });
  const fixed: Array<Parameters<TransactionRemote["fix"]>[0]> = [];
  using _app = setupTransactionsPage({
    open: listData([add], { open: 1, today: 1, saved: 0, ended: 0 }),
    fix: (input) => {
      fixed.push(input);
      return Promise.resolve({ status: "fixed", move: input.move });
    },
  });

  await expect.element(page.getByText("Blocked", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText(
        "Add Jordan Lee needs a roster place, and this plan does not free one. Add a drop or a reserve move that frees a place, or remove this move.",
        { exact: true },
      ),
    )
    .toBeVisible();

  await page.getByRole("button", { name: "Add roster fixes: Add Jordan Lee" }).click();

  await expect
    .element(
      page.getByText("Added the roster fixes that make room for Add Jordan Lee.", { exact: true }),
    )
    .toBeVisible();
  expect(fixed).toStrictEqual([{ team: alpha.id, move: add.move }]);
});

it("names the move a blocked card waits on and opens or discards its group", async () => {
  await page.viewport(1280, 900);
  const group = "018f79ea-7d86-7c18-9b4a-8b4d0c9165f2";
  const dependency = "Drop Runner C waits on The trade, which is waiting on the league's answer.";
  const drop = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165f3",
    team: alpha,
    group,
    kind: "drop",
    decision: "now",
    drops: [player("Runner C")],
    validation: {
      status: "stale",
      checkedAt: now,
      reasons: [{ code: "pending_outcome", detail: dependency }],
    },
  });
  const detail = `This group does not run. ${dependency}`;
  const discarded: Array<Parameters<TransactionRemote["discardGroup"]>[0]> = [];
  using _app = setupTransactionsPage({
    open: listData(
      [drop],
      { open: 1, today: 1, saved: 0, ended: 0 },
      [],
      [
        {
          group,
          team: alpha.id,
          label: "Weekend moves",
          status: "blocked",
          moves: [drop.move],
          actions: [],
          notRun: [],
          detail,
        },
      ],
    ),
    discardGroup: (input) => {
      discarded.push(input);
      return Promise.resolve({ status: "discarded", move: input.move });
    },
  });

  await expect.element(page.getByText(dependency, { exact: true })).toBeVisible();
  await expect.element(page.getByText(detail, { exact: true })).not.toBeVisible();

  await page.getByRole("button", { name: "Open: Weekend moves" }).click();
  await expect.element(page.getByText(detail, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Discard group: Weekend moves" }).click();
  await expect
    .element(page.getByText("Discarded what was left of this group.", { exact: true }))
    .toBeVisible();
  expect(discarded).toStrictEqual([{ team: alpha.id, move: drop.move }]);
});

it("retries a failed card whose check still passes", async () => {
  await page.viewport(1280, 900);
  const failed = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165f4",
    team: alpha,
    kind: "drop",
    decision: "now",
    drops: [player("Riley Chen")],
    result: "failed",
    resultDetail: "Your league refused the drop.",
    resultAt: now,
  });
  const retried: Array<Parameters<TransactionRemote["retry"]>[0]> = [];
  using _app = setupTransactionsPage({
    open: listData([failed], { open: 1, today: 1, saved: 0, ended: 0 }),
    retry: (input) => {
      retried.push(input);
      return Promise.resolve({
        status: "retried",
        retried: [input.move],
        counts: { moves: 1, executed: 1, pending: 0, failed: 0, skipped: 0, unknown: 0 },
        refusals: [],
      });
    },
  });

  await expect.element(page.getByText("Failed", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText("Your league refused the drop.", { exact: true }))
    .toBeVisible();

  await page.getByRole("button", { name: "Retry: Drop Riley Chen" }).click();

  await expect
    .element(page.getByText("Retried 1 move. 1 move ran.", { exact: true }))
    .toBeVisible();
  expect(retried).toHaveLength(1);
  expect(retried[0]?.team).toBe(alpha.id);
  expect(retried[0]?.move).toBe(failed.move);
  expect(retried[0]?.key.length ?? 0).toBeGreaterThan(0);
});

it("moves a card with nothing left to do into Earlier without a control", async () => {
  await page.viewport(1280, 900);
  const group = "018f79ea-7d86-7c18-9b4a-8b4d0c9165f5";
  const drop = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165f6",
    team: alpha,
    group,
    kind: "drop",
    decision: "now",
    drops: [player("Riley Chen")],
    result: "executed",
  });
  const claim = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165f7",
    team: alpha,
    group,
    position: 1,
    kind: "waiver_claim",
    decision: "now",
    phase: "with_league",
    adds: [player("Amon-Ra St. Brown")],
    drops: [],
    result: "pending",
  });
  const cure = "Check your roster, then choose the move again or discard it.";
  const account =
    "This group ran in part. The drop of Riley Chen reached your league. The claim of Amon-Ra St. Brown waits on the league's answer.";
  using _app = setupTransactionsPage({
    open: listData(
      [drop, claim],
      { open: 2, today: 2, saved: 0, ended: 0 },
      [],
      [
        {
          group,
          team: alpha.id,
          status: "partly_done",
          moves: [drop.move, claim.move],
          actions: [
            { move: drop.move, action: "drop", player: "Riley Chen", outcome: "executed" },
            {
              move: claim.move,
              action: "add",
              player: "Amon-Ra St. Brown",
              outcome: "pending",
            },
          ],
          notRun: [],
          detail: `${account} ${cure}`,
          cure,
        },
      ],
    ),
  });

  await expect.element(page.getByText("Nothing for today", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByText("Partly ran", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText("Nothing is waiting for you.", { exact: true }))
    .toBeVisible();
  expect(page.getByRole("button", { name: /Retry:/u }).elements()).toHaveLength(0);
  expect(page.getByRole("button", { name: /Discard remaining:/u }).elements()).toHaveLength(0);
  expect(page.getByRole("button", { name: /Run now/u }).elements()).toHaveLength(0);
  expect(page.getByRole("button", { name: /Discard:/u }).elements()).toHaveLength(0);

  await page.getByText("Why these moves", { exact: true }).click();
  await expect.element(page.getByText(account, { exact: true })).toBeVisible();
  expect(page.getByText(`${account} ${cure}`, { exact: true }).elements()).toHaveLength(0);
});

it("shows the stored fallback chain before it is needed", async () => {
  await page.viewport(1280, 900);
  const claim = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165f8",
    team: alpha,
    kind: "waiver_claim",
    adds: [player("Amon-Ra St. Brown")],
    drops: [player("Romeo Doubs")],
    fallbacks: [player("Tank Bigsby"), player("Tyler Boyd")],
  });
  using _app = setupTransactionsPage({
    open: listData([claim], { open: 1, today: 1, saved: 0, ended: 0 }),
  });

  await expect
    .element(page.getByText("Claim Amon-Ra St. Brown and drop Romeo Doubs", { exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByText("If the claim fails: Tank Bigsby, then Tyler Boyd", { exact: true }))
    .toBeVisible();
  const body = "Lineupgrade tries them in this order if the first fails.";
  await expect.element(page.getByText(body, { exact: true })).not.toBeVisible();

  await page.getByText("If the claim fails: Tank Bigsby, then Tyler Boyd", { exact: true }).click();
  await expect.element(page.getByText(body, { exact: true })).toBeVisible();
  expect(EffectString.toLowerCase(document.body.textContent)).not.toContain("suggestion");
});

it("records which fallback ran, which failed, and that none are left", async () => {
  await page.viewport(1280, 900);
  const claim = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165f9",
    team: alpha,
    kind: "waiver_claim",
    decision: "now",
    phase: "lost",
    adds: [player("Amon-Ra St. Brown")],
    drops: [player("Romeo Doubs")],
    fallbacks: [player("Tank Bigsby"), player("Tyler Boyd")],
    result: "failed",
    resultDetail: "All choices failed. Nothing is waiting.",
    runDay: today,
    attempts: [
      {
        kind: "claim",
        player: player("Amon-Ra St. Brown"),
        outcome: "lost",
        reason: "Your league awarded the claim to another team.",
        at: now,
      },
      {
        kind: "fallback",
        player: player("Tank Bigsby"),
        outcome: "failed",
        reason: "That player is already taken.",
        at: now,
      },
      {
        kind: "fallback",
        player: player("Tyler Boyd"),
        outcome: "unavailable",
        reason: "Tyler Boyd is no longer available.",
        at: now,
      },
    ],
  });
  using _app = setupTransactionsPage({
    open: listData([], { open: 0, today: 0, saved: 0, ended: 1 }),
    ended: listData([claim], { open: 0, today: 0, saved: 0, ended: 1 }),
  });

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByRole("img", { name: "All choices failed" })).toBeVisible();
  expect(
    page.getByText(`Takes effect ${formatCalendarDate("2026-11-18")}.`, { exact: true }).elements(),
  ).toHaveLength(0);
  const summary = page.getByText("What was tried", { exact: true });
  await expect.element(summary).toBeVisible();
  await summary.click();

  await expect
    .element(
      page.getByText("The claim failed: Your league awarded the claim to another team.", {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect
    .element(page.getByText("Tank Bigsby failed: That player is already taken.", { exact: true }))
    .toBeVisible();
  await expect
    .element(
      page.getByText("Tyler Boyd was not available: Tyler Boyd is no longer available.", {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect.element(page.getByText("No choices are left.", { exact: true })).toBeVisible();
});

it("leaves one submission line and one effect line after a lost claim's fallback runs", async () => {
  await page.viewport(1280, 900);
  const claim = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165fa",
    team: alpha,
    kind: "free_agent_add",
    decision: "now",
    phase: "lost",
    adds: [player("Pat Freiermuth")],
    drops: [player("TreVeyon Henderson")],
    fallbacks: [player("Pat Freiermuth")],
    confirmation: { by: "owner", at: "2026-11-16T15:58:00.000Z" },
    runAt: "2026-11-18T22:25:00.000Z",
    runDecidedBy: "system",
    effectiveDate: "2026-11-19",
    result: "executed",
    resultDetail: "The claim was lost. Your fallback Pat Freiermuth was added instead.",
    resultAt: "2026-11-18T22:25:00.000Z",
    attempts: [
      {
        kind: "claim",
        player: player("Dalton Schultz"),
        outcome: "lost",
        reason: "Your league awarded the claim to another team.",
        at: "2026-11-18T22:25:00.000Z",
      },
      {
        kind: "fallback",
        player: player("Pat Freiermuth"),
        outcome: "executed",
        reason: "Added after the league did not award the claim.",
        at: "2026-11-18T22:25:00.000Z",
        effectiveDate: "2026-11-19",
      },
    ],
  });
  using _app = setupTransactionsPage({
    open: listData([], { open: 0, today: 0, saved: 0, ended: 1 }),
    ended: listData([claim], { open: 0, today: 0, saved: 0, ended: 1 }),
  });

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByRole("img", { name: "Claim lost, fallback ran" })).toBeVisible();
  await expect
    .element(page.getByText("The claim for Dalton Schultz did not run.", { exact: true }))
    .toBeVisible();
  await expect.element(page.getByText(/^You submitted this on /u)).toBeVisible();
  await expect.element(page.getByText("Took effect November 19.", { exact: true })).toBeVisible();
  expect(
    page
      .getByText("The claim was lost. Your fallback Pat Freiermuth was added instead.", {
        exact: true,
      })
      .elements(),
  ).toHaveLength(0);
  expect(page.getByText(/Claim lost, fallback ran .+ at /u).elements()).toHaveLength(0);
  expect(
    page.getByText("If the claim fails: Pat Freiermuth", { exact: true }).elements(),
  ).toHaveLength(0);
});

it("shows counted earlier skeletons until older moves arrive", async () => {
  await page.viewport(1280, 900);
  const ran = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165f9",
    team: alpha,
    decision: "now",
    drops: [player("Riley Chen")],
    result: "executed",
    runDecidedBy: "system",
  });
  const pending = Promise.withResolvers<TransactionMoveListData>();
  using _app = setupTransactionsPage({
    open: listData([], { open: 0, today: 0, saved: 0, ended: 4 }),
    ended: listData([ran], { open: 0, today: 0, saved: 0, ended: 4 }),
    endedPending: pending.promise,
  });

  await expect.element(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
  await expect
    .element(page.getByText("0 open moves · 0 today · 0 later", { exact: true }))
    .toBeVisible();
  await page.getByRole("button", { name: "Show earlier moves" }).click();
  const loader = page.getByRole("status", { name: "Loading earlier moves" });
  await expect.element(loader).toBeVisible();
  expect(loader.getByRole("listitem").elements()).toHaveLength(3);

  pending.resolve(listData([ran], { open: 0, today: 0, saved: 0, ended: 4 }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(loader.elements()).toHaveLength(1);
  await expect.element(page.getByRole("img", { name: "Ran on schedule" })).toBeVisible();
});

it("keeps Earlier collapsed until the person opens it", async () => {
  await page.viewport(1280, 900);
  const ran = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165fa",
    team: alpha,
    decision: "now",
    drops: [player("Riley Chen")],
    result: "executed",
    runDecidedBy: "system",
  });
  using _app = setupTransactionsPage({
    open: listData([], { open: 0, today: 0, saved: 0, ended: 1 }),
    ended: listData([ran], { open: 0, today: 0, saved: 0, ended: 1 }),
  });

  await expect.element(page.getByRole("button", { name: "Show earlier moves" })).toBeVisible();
  expect(page.getByRole("img", { name: "Ran on schedule" }).elements()).toHaveLength(0);

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByRole("img", { name: "Ran on schedule" })).toBeVisible();

  await page.getByRole("button", { name: "Hide earlier moves" }).click();
  await expect.element(page.getByRole("button", { name: "Show earlier moves" })).toBeVisible();
  expect(page.getByRole("img", { name: "Ran on schedule" }).elements()).toHaveLength(0);
});

it("keeps Earlier collapsed while a card needs a decision", async () => {
  await page.viewport(1280, 900);
  const openMove = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165fb",
    team: alpha,
    kind: "drop",
    drops: [player("Riley Chen")],
  });
  const ran = move({
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165fc",
    team: alpha,
    decision: "now",
    drops: [player("Jordan Lee")],
    result: "executed",
    runDecidedBy: "system",
  });
  using _app = setupTransactionsPage({
    open: listData([openMove], { open: 1, today: 1, saved: 0, ended: 1 }),
    ended: listData([ran], { open: 0, today: 0, saved: 0, ended: 1 }),
  });

  await expect.element(page.getByRole("button", { name: "Show earlier moves" })).toBeVisible();
  expect(page.getByRole("img", { name: "Ran on schedule" }).elements()).toHaveLength(0);

  await page.getByRole("button", { name: "Show earlier moves" }).click();
  await expect.element(page.getByRole("img", { name: "Ran on schedule" })).toBeVisible();
  await page.getByRole("button", { name: "Hide earlier moves" }).click();
  expect(page.getByRole("img", { name: "Ran on schedule" }).elements()).toHaveLength(0);
});

function setupTransactionsPage(options: {
  readonly open: TransactionMoveListData;
  readonly teamCount?: number;
  readonly failure?: Error;
  readonly confirm?: TransactionRemote["confirm"];
  readonly save?: TransactionRemote["save"];
  readonly discard?: TransactionRemote["discard"];
  readonly discardGroup?: TransactionRemote["discardGroup"];
  readonly fix?: TransactionRemote["fix"];
  readonly retry?: TransactionRemote["retry"];
  readonly ended?: TransactionMoveListData;
  readonly endedPages?: ReadonlyArray<TransactionMoveListData>;
  readonly endedPending?: Promise<TransactionMoveListData>;
  readonly timeline?: TransactionRemote["timeline"];
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
    timeline:
      options.timeline ??
      (() =>
        options.failure === undefined ? Promise.resolve(open) : Promise.reject(options.failure)),
    list: (input) => {
      if (input.state !== "ended") {
        return Promise.resolve(open);
      }
      if (options.endedPending !== undefined) {
        return options.endedPending;
      }
      const page = input.after === undefined ? endedPages[0] : endedPages[1];
      return Promise.resolve(page ?? emptyEnded);
    },
    plan: () =>
      Promise.resolve({
        team: alpha,
        nextCheckAt,
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
    discardGroup:
      options.discardGroup ?? (() => Promise.reject(new Error("Unexpected group discard"))),
    fix: options.fix ?? (() => Promise.reject(new Error("Unexpected roster fixes"))),
    retry: options.retry ?? (() => Promise.reject(new Error("Unexpected retry"))),
    confirm: options.confirm ?? (() => Promise.reject(new Error("Unexpected confirmation"))),
  };
  if (options.failure === undefined && options.timeline === undefined) {
    queryClient.setQueryData(transactionQueries.timeline(remote).queryKey, {
      pages: [open],
      pageParams: [undefined],
    });
    if (options.endedPending === undefined) {
      queryClient.setQueryData(transactionQueries.list(remote, { state: "ended" }).queryKey, {
        pages: [endedPages[0] ?? emptyEnded],
        pageParams: [undefined],
      });
    }
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
  const todayMoves = EffectArray.filter(
    moves,
    (move) =>
      (move.decision === "now" || move.decision === "undecided") &&
      (move.runDay === undefined || move.runDay === today),
  );
  const savedMoves = EffectArray.filter(
    moves,
    (move) => (move.decision === "saved" || move.decision === "confirmed") && move.runDay !== today,
  );
  const days: Array<TransactionMoveListData["days"][number]> = [];
  if (todayMoves.length > 0) {
    days.push({ day: today, groupedBy: "runDay", today: true, teams: group(todayMoves) });
  }
  for (const move of savedMoves) {
    days.push({
      day: move.runDay,
      groupedBy: "runDay",
      today: false,
      teams: [{ team: move.team, moves: [move] }],
    });
  }
  return {
    status: "ok",
    nextCheckAt,
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
  return new Set(EffectArray.map(moves, (move) => move.team.id)).size;
}

function fixtureStatus(move: Omit<TransactionMoveView, "status">): TransactionMoveView["status"] {
  if (move.decision === "discarded") {
    return "discarded";
  }
  switch (move.phase) {
    case "with_league":
      return "claim_waiting";
    case "won":
      return "claim_won";
    case "lost":
      switch (move.result) {
        case "executed":
          return "claim_lost_fallback_ran";
        case "pending":
          return "claim_lost_retrying";
        case "unknown":
          return "fallback_unknown";
        case "failed":
          return EffectArray.some(move.attempts, (attempt) => attempt.kind === "fallback")
            ? "all_choices_failed"
            : "claim_lost";
        case "skipped":
          return "skipped";
        case undefined:
          return "claim_lost";
      }
      break;
    case undefined:
      break;
  }
  switch (move.result) {
    case "executed":
      return move.runDecidedBy === "system" ? "ran_on_schedule" : "ran_immediately";
    case "pending":
      return move.kind === "trade" ? "offer_sent" : "open_now";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "unknown":
      return "unknown";
    case undefined:
      switch (move.decision) {
        case "undecided":
          return "open_undecided";
        case "saved":
          return "open_saved";
        case "now":
          return "open_now";
        case "confirmed":
          return "open_confirmed";
      }
  }
}

function move(
  overrides: Partial<TransactionMoveView> & { readonly team: TransactionMoveTeamView },
): TransactionMoveView {
  const base: Omit<TransactionMoveView, "status"> = {
    move: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a9",
    kind: "drop",
    position: 0,
    decision: "undecided",
    reason: "Make the roster change.",
    attempts: [],
    adds: [],
    fallbacks: [],
    drops: [player("Riley Chen")],
    picks: [],
    validation: { status: "current", checkedAt: now, reasons: [] },
    check: { status: "checked" },
    team: overrides.team,
  };
  const merged = { ...base, ...overrides };
  return {
    ...merged,
    status: overrides.status ?? fixtureStatus(merged),
  };
}

function player(name: string): { readonly name: string } {
  return { name };
}
