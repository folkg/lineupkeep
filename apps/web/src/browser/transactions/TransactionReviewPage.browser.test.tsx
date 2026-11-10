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
  TransactionReviewData,
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
    .not.toHaveAttribute("aria-disabled");
  await expect
    .element(page.getByText("3 of 4 moves included. 1 waiver claim spends 25 FAAB."))
    .toBeVisible();
  await expect.element(page.getByText(/Each move is sent once, with no retries/u)).toBeVisible();
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

it("starts an illegal move excluded and names the player, slot, and choice", async () => {
  using _app = setupReviewPage({
    ...reviewFixture(),
    teams: [teamFixture(alphaId, "Alpha", "nfl", "football", [waiverItem(), illegalItem()])],
  });

  const illegal = page.getByRole("checkbox", { name: /Drop Riley Chen/u });
  await expect.element(illegal).not.toBeChecked();
  await expect.element(illegal).toBeDisabled();
  await expect.element(page.getByText("Illegal roster position")).toBeVisible();
  await expect.element(page.getByText(/Travis Konecny is in the IR slot/u)).toBeVisible();
  await expect.element(page.getByText(/choosing which player to drop is yours/u)).toBeVisible();
});

it("names both sides of every draft pick and says it cannot be sent", async () => {
  using _app = setupReviewPage({
    ...reviewFixture(),
    teams: [tradeTeam(pickTradeItem())],
  });

  await expect.element(page.getByText("Round 1 pick from Alpha to Beta")).toBeVisible();
  await expect.element(page.getByText("Round 2 pick from Beta to Alpha")).toBeVisible();
  await expect.element(page.getByText("Draft picks cannot be sent yet")).toBeVisible();
  await expect.element(page.getByText(/accepts players only/u)).toBeVisible();
});

it("shows the provider's exact refusal wording on a failed move", async () => {
  const providerRefusal =
    "The provider rejected the transaction with HTTP 400. It said: Player Travis Konecny is in a IR position on your roster, but is no longer on the real-life IR. Please edit your lineup to activate this player from your IR and then attempt your transaction again.";
  using _app = setupReviewPage({
    ...reviewFixture(),
    teams: [
      teamFixture(alphaId, "Alpha", "nfl", "football", [
        {
          ...freeAgentItem(),
          state: "failed",
          execution: {
            outcome: "failed",
            detail: providerRefusal,
            decidedAt: now,
            steps: [
              {
                kind: "add",
                playerName: "Mika Olsen",
                outcome: "failed",
                detail: providerRefusal,
                decidedAt: now,
              },
            ],
          },
        },
      ]),
    ],
  });

  await expect.element(page.getByText(providerRefusal).first()).toBeVisible();
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
    .not.toHaveAttribute("aria-disabled");

  await waiver.click();
  await expect.element(waiver).toBeChecked();
  await expect
    .element(page.getByRole("button", { name: "Submit 3 moves" }))
    .not.toHaveAttribute("aria-disabled");
});

it("sends the bids raised at review for two claims proposed at 0", async () => {
  const review = twoBidReview();
  const first = review.teams[0]?.items[0];
  const second = review.teams[0]?.items[1];
  if (first === undefined || second === undefined) {
    throw new Error("the two-claim fixture has both claims");
  }
  const submissions: Array<{
    readonly set: string;
    readonly include: ReadonlyArray<string>;
    readonly bids: ReadonlyArray<{ readonly item: string; readonly bid: number }>;
  }> = [];
  using _app = setupReviewPage(review, {
    submit: (input) => {
      submissions.push(input);
      return Promise.resolve({
        review: pendingReviewFrom(review),
        submittedBids: [
          { item: first.id, bid: 12 },
          { item: second.id, bid: 3 },
        ],
      });
    },
  });

  const firstBid = page.getByLabelText("FAAB bid for Sam Rivers");
  const secondBid = page.getByLabelText("FAAB bid for Owen Park");
  await expect.element(firstBid).toHaveValue(0);
  await expect.element(secondBid).toHaveValue(0);

  await firstBid.fill("12");
  await secondBid.fill("3");
  await expect
    .element(page.getByText("2 of 2 moves included. 2 waiver claims spend 15 FAAB."))
    .toBeVisible();

  await page.getByRole("button", { name: "Submit 2 moves" }).click();
  expect(submissions).toStrictEqual([
    {
      set: review.set.id,
      include: [first.id, second.id],
      bids: [
        { item: first.id, bid: 12 },
        { item: second.id, bid: 3 },
      ],
    },
  ]);
  await expect.element(page.getByText("Bid 12 FAAB sent; proposed at 0 FAAB.")).toBeVisible();
  await expect.element(page.getByText("Bid 3 FAAB sent; proposed at 0 FAAB.")).toBeVisible();
});

it("shows a bid above the remaining budget before submitting and sends nothing", async () => {
  let submissions = 0;
  using _app = setupReviewPage(twoBidReview(), {
    submit: () => {
      submissions += 1;
      return Promise.resolve({ review: twoBidReview() });
    },
  });

  await page.getByLabelText("FAAB bid for Sam Rivers").fill("60");
  const refusal =
    "The bid of 60 exceeds this team's remaining FAAB budget of 50. Lower the bid to 50 or less, then submit again.";
  await expect.element(page.getByText(refusal)).toBeVisible();

  await page.getByRole("button", { name: "Submit 2 moves" }).click();
  expect(submissions).toBe(0);
  await expect.element(page.getByText(refusal).first()).toBeVisible();
});

it("says what a FAAB bid is when it is not whole or below the league minimum", async () => {
  let submissions = 0;
  using _app = setupReviewPage(twoBidReview(), {
    submit: () => {
      submissions += 1;
      return Promise.resolve({ review: twoBidReview() });
    },
  });

  const bid = page.getByLabelText("FAAB bid for Sam Rivers");
  await bid.fill("2.5");
  await expect
    .element(
      page.getByText("A FAAB bid is a whole number of FAAB from 0 upward, so 2.5 cannot be sent."),
    )
    .toBeVisible();

  await bid.fill("-1");
  await expect
    .element(
      page.getByText("The league's minimum FAAB bid is 0, so -1 cannot be sent. Enter 0 or more."),
    )
    .toBeVisible();

  await page.getByRole("button", { name: "Submit 2 moves" }).click();
  expect(submissions).toBe(0);
});

it("shows a settled claim's bid as fact and offers no input", async () => {
  const pending = pendingWaiverItem();
  using _app = setupReviewPage({
    ...reviewFixture(),
    set: {
      ...reviewFixture().set,
      submissions: [{ submittedAt: now, completedAt: now }],
    },
    teams: [teamFixture(alphaId, "Alpha", "nfl", "football", [pending])],
  });

  expect(page.getByLabelText("FAAB bid for Sam Rivers").elements()).toHaveLength(0);
  await expect.element(page.getByText("Proposed at 25 FAAB.", { exact: true })).toBeVisible();
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

const tradeItemId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165c1";
const providerOfferRef = "r1.offerReference";

function tradeItem(state: "proposed" | "pending" | "withdrawn"): TransactionReviewItemView {
  const trade =
    state === "pending"
      ? {
          state: "pending" as const,
          requestedAt: oneHourAgo,
          proposedAt: oneHourAgo,
        }
      : state === "withdrawn"
        ? {
            state: "withdrawn" as const,
            requestedAt: oneHourAgo,
            proposedAt: oneHourAgo,
            settledAt: twoHoursAgo,
            detail: "Withdrawn before acceptance. The provider deletes a withdrawn offer.",
          }
        : undefined;
  return {
    id: tradeItemId,
    kind: "trade",
    adds: [player("Marco Diaz", "RW", "NYR", "Healthy")],
    drops: [player("Elias Ford", "C", "BOS", "Healthy")],
    picks: [],
    counterparty: { ref: "r1.counterparty", name: "Beta", managerName: "Dana Ruiz" },
    reason: "Swap a center for a wing.",
    state,
    staleness: { status: "current", checkedAt: now, reasons: [] },
    ...(trade === undefined
      ? {}
      : {
          trade,
          execution: {
            outcome: "pending" as const,
            detail:
              "Offer sent to Beta. The other manager decides; we cannot accept on their behalf.",
            decidedAt: oneHourAgo,
            steps: [],
          },
        }),
  };
}

function pickTradeItem(): TransactionReviewItemView {
  return {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c9",
    kind: "trade",
    adds: [],
    drops: [],
    picks: [
      {
        round: 1,
        from: { ref: alphaId, name: "Alpha" },
        to: { ref: "r1.counterparty", name: "Beta" },
      },
      {
        round: 2,
        from: { ref: "r1.counterparty", name: "Beta" },
        to: { ref: alphaId, name: "Alpha" },
      },
    ],
    counterparty: { ref: "r1.counterparty", name: "Beta", managerName: "Dana Ruiz" },
    reason: "Trade a first for a second.",
    state: "proposed",
    staleness: { status: "current", checkedAt: now, reasons: [] },
  };
}

function tradeTeam(item: TransactionReviewItemView): TransactionReviewTeamView {
  return {
    team: { id: alphaId, name: "Alpha", league: "nfl", sport: "football", season: 2026 },
    tradeProposal: {
      assets: ["player"],
      detail:
        "The provider's trade request accepts players only, and this connection cannot send a draft pick.",
    },
    tradeRules: { endDate: "2026-11-28", ratification: "vote", objectionDays: 2 },
    items: [item],
    pendingOffers: [],
  };
}

function tradeReviewFixture(): TransactionReviewView {
  return {
    ...reviewFixture(),
    teams: [tradeTeam(tradeItem("proposed"))],
  };
}

function pendingTradeReviewFixture(): TransactionReviewView {
  return {
    ...reviewFixture(),
    set: {
      ...reviewFixture().set,
      submissions: [{ submittedAt: now, completedAt: now }],
      settled: false,
    },
    teams: [tradeTeam(tradeItem("pending"))],
  };
}

function withdrawnTradeReviewFixture(): TransactionReviewView {
  return {
    ...reviewFixture(),
    set: {
      ...reviewFixture().set,
      submissions: [{ submittedAt: now, completedAt: now }],
      settled: true,
    },
    teams: [tradeTeam(tradeItem("withdrawn"))],
  };
}

function providerOfferReviewFixture(): TransactionReviewView {
  return {
    ...reviewFixture(),
    teams: [
      teamFixture(alphaId, "Alpha", "nfl", "football", [dropItem()]),
      {
        ...teamFixture(betaId, "Beta", "nhl", "hockey", []),
        pendingOffers: [
          {
            offerRef: providerOfferRef,
            proposedAt: oneHourAgo,
            canRespond: false,
            proposingTeam: { ref: "r1.beta", name: "Beta" },
            receivingTeam: { ref: "r1.delta", name: "Delta" },
            players: [
              {
                player: "r1.player",
                name: "Casey Trail",
                displayPosition: "LW",
                proTeam: "SEA",
                from: { ref: "r1.beta", name: "Beta" },
                to: { ref: "r1.delta", name: "Delta" },
              },
            ],
            picks: [],
          },
        ],
      },
    ],
  };
}

function reviewFixture(): TransactionReviewView {
  return {
    set: {
      id: setId,
      proposedBy: { kind: "agent", surface: "mcp" },
      createdAt: oneHourAgo,
      expiresAt: twentyThreeHours,
      expired: false,
      submissions: [],
      settled: false,
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
    pendingOffers: [],
  };
}

function waiverItem(): TransactionReviewItemView {
  return {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b1",
    kind: "waiver_claim",
    adds: [player("Sam Rivers", "WR", "SEA", "Questionable")],
    drops: [player("Alex Vance", "RB", "SF", "Out")],
    picks: [],
    bid: 25,
    reason: "Cover the receiver spot before Sunday.",
    state: "proposed",
    staleness: { status: "current", checkedAt: now, reasons: [] },
  };
}

function twoBidReview(): TransactionReviewView {
  const first: TransactionReviewItemView = {
    ...waiverItem(),
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c1",
    bid: 0,
    reason: "Claim the first wing.",
  };
  const second: TransactionReviewItemView = {
    ...waiverItem(),
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c2",
    adds: [player("Owen Park", "D", "TOR", "Free agent")],
    drops: [],
    bid: 0,
    reason: "Claim the second wing.",
  };
  return {
    ...reviewFixture(),
    teams: [teamFixture(alphaId, "Alpha", "nfl", "football", [first, second])],
  };
}

function pendingReviewFrom(review: TransactionReviewView): TransactionReviewView {
  return {
    ...review,
    set: {
      ...review.set,
      submissions: [{ submittedAt: now, completedAt: now }],
    },
    teams: review.teams.map((team) => ({
      ...team,
      items: team.items.map((item) => ({
        ...item,
        state: "pending" as const,
        execution: {
          outcome: "pending" as const,
          detail: "Waivers run later.",
          decidedAt: now,
          steps: [],
        },
      })),
    })),
  };
}

function staleItem(): TransactionReviewItemView {
  return {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b2",
    kind: "free_agent_add",
    adds: [player("Jordan Lee", "C", "BOS", "Free agent")],
    drops: [],
    picks: [],
    reason: "Add a center for the light night.",
    state: "proposed",
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

function illegalItem(): TransactionReviewItemView {
  return {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b7",
    kind: "drop",
    adds: [],
    drops: [player("Riley Chen", "LW", "NYR")],
    picks: [],
    reason: "Open a roster spot.",
    state: "proposed",
    staleness: {
      status: "illegal",
      checkedAt: now,
      reasons: [
        {
          code: "slot_illegal",
          detail:
            "Travis Konecny is in the IR slot, but the provider no longer accepts him there. No open slot accepts him, and choosing which player to drop is yours. Drop a player to make room, then propose this transaction again.",
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
    picks: [],
    reason: "Take the better wing before the weekend.",
    state: "proposed",
    staleness: { status: "current", checkedAt: now, reasons: [] },
  };
}

function slotMoveItem(): TransactionReviewItemView {
  return {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b8",
    kind: "slot_move",
    adds: [],
    drops: [],
    picks: [],
    slotMove: { playerName: "Casey Moss", fromSlot: "IR", toSlot: "BN" },
    reason: "Move the reserve center to the bench.",
    state: "proposed",
    staleness: { status: "current", checkedAt: now, reasons: [] },
  };
}

function dropItem(): TransactionReviewItemView {
  return {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b4",
    kind: "drop",
    adds: [],
    drops: [player("Riley Chen", "LW", "NYR")],
    picks: [],
    reason: "Open a roster spot.",
    state: "proposed",
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

it("says when the league applies the moves without listing them by order", async () => {
  const base = reviewFixture();
  const alpha = base.teams[0];
  if (alpha === undefined) {
    throw new Error("the review fixture has an alpha team");
  }
  using _app = setupReviewPage({
    ...base,
    teams: [
      {
        ...alpha,
        order: {
          status: "ordered",
          timing: "same_day",
          effectiveDate: "2026-11-04",
          rosterPlaces: { maximum: 9, occupied: 6, net: 0 },
          steps: [
            { item: waiverItem().id, position: 0 },
            { item: freeAgentItem().id, position: 1 },
          ],
        },
      },
      ...base.teams.slice(1),
    ],
  });

  await expect.element(page.getByText("When these moves run", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText("The league applies these moves on 2026-11-04.", { exact: true }))
    .toBeVisible();
  expect(
    page.getByText(/^[0-9]+\. (Add|Move|Drop)/u).elements(),
    "the plan does not number the moves",
  ).toHaveLength(0);
  await expect
    .element(
      page.getByText("This team holds 6 of 9 roster places; the set leaves the count unchanged.", {
        exact: true,
      }),
    )
    .toBeVisible();
});

it("shows a refusal that names both operations when no legal order exists", async () => {
  const base = reviewFixture();
  const alpha = base.teams[0];
  if (alpha === undefined) {
    throw new Error("the review fixture has an alpha team");
  }
  const move = waiverItem();
  const drop = dropItem();
  const detail =
    "Moving Roster Three to BN needs a free BN slot, and it is full. Dropping Roster One frees the C slot, not BN. The two operations cannot both be legal on 2026-11-04.";
  using _app = setupReviewPage({
    ...base,
    teams: [
      {
        ...alpha,
        order: {
          status: "conflict",
          timing: "same_day",
          effectiveDate: "2026-11-04",
          conflicts: [{ items: [move.id, drop.id], detail }],
        },
      },
      ...base.teams.slice(1),
    ],
  });

  await expect
    .element(page.getByText("No legal order for these moves", { exact: true }))
    .toBeVisible();
  await expect.element(page.getByText(detail, { exact: true })).toBeVisible();
});

it("reports a settled lineup separately from the moves", async () => {
  const base = reviewFixture();
  using _app = setupReviewPage({
    ...base,
    set: {
      ...base.set,
      submissions: [{ submittedAt: now, completedAt: now }],
      settled: true,
    },
    teams: [
      {
        ...teamFixture(alphaId, "Alpha", "nfl", "football", [dropItem()]),
        lineup: {
          status: "settled",
          detail: "Set the lineup for 2026-10-31 after the add.",
          run: "01M68X9EG00T861YNAKZM8FPFK",
          at: now,
        },
      },
    ],
  });

  await expect.element(page.getByText("Lineup", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText("Set the lineup for 2026-10-31 after the add.", { exact: true }))
    .toBeVisible();
});

it("shows what was sent and why a later move stopped", async () => {
  const base = reviewFixture();
  const rejection =
    "The provider rejected the transaction with HTTP 400. It said: That player is not on your roster.";
  const stopped = `${rejection} Later moves on this team were not checked against the resulting roster.`;
  using _app = setupReviewPage({
    ...base,
    set: {
      ...base.set,
      submissions: [{ submittedAt: now, completedAt: now }],
      settled: false,
    },
    teams: [
      teamFixture(alphaId, "Alpha", "nhl", "hockey", [
        {
          ...slotMoveItem(),
          state: "skipped",
          execution: {
            position: 1,
            outcome: "skipped",
            detail: `Not attempted because Dropping Riley Chen failed. ${stopped}`,
            decidedAt: now,
            steps: [],
          },
        },
        {
          ...dropItem(),
          state: "failed",
          execution: {
            position: 0,
            outcome: "failed",
            detail: rejection,
            decidedAt: now,
            steps: [
              {
                kind: "drop",
                playerName: "Riley Chen",
                outcome: "failed",
                detail: rejection,
                decidedAt: now,
              },
            ],
          },
        },
      ]),
      ...base.teams.slice(1),
    ],
  });

  await expect.element(page.getByText("What was sent", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Drop Riley Chen — Failed", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText("Move Casey Moss to BN — Skipped", { exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByText("Sent in this submission.", { exact: true }).first())
    .toBeVisible();
  await expect
    .element(page.getByText(/Not attempted because Dropping Riley Chen failed/u))
    .toBeVisible();
});

it("shows a declared slot move as its own move", async () => {
  const base = reviewFixture();
  using _app = setupReviewPage({
    ...base,
    teams: [
      teamFixture(alphaId, "Alpha", "nfl", "football", [slotMoveItem()]),
      ...base.teams.slice(1),
    ],
  });

  await expect
    .element(
      page.getByText("Move Casey Moss to BN. It runs where the roster stays legal.", {
        exact: true,
      }),
    )
    .toBeVisible();
  await expect
    .element(page.getByRole("checkbox", { name: /Include: Move Casey Moss to BN/u }))
    .toBeVisible();
});

it("shows a roster move before the transaction", async () => {
  const base = reviewFixture();
  const reservation: TransactionReviewItemView = {
    ...waiverItem(),
    reserveMove: { playerName: "Casey Moss", fromSlot: "BN", toSlot: "IR", order: "before" },
  };
  using _app = setupReviewPage({
    ...base,
    teams: [
      teamFixture(alphaId, "Alpha", "nfl", "football", [reservation]),
      ...base.teams.slice(1),
    ],
  });

  await expect.element(page.getByText("Roster move first")).toBeVisible();
  await expect.element(page.getByText(/Move Casey Moss from BN to IR/u)).toBeVisible();
});

it("shows a roster move after the transaction that frees its destination", async () => {
  const base = reviewFixture();
  const reservation: TransactionReviewItemView = {
    ...waiverItem(),
    reserveMove: { playerName: "Casey Moss", fromSlot: "BN", toSlot: "IR", order: "after" },
  };
  using _app = setupReviewPage({
    ...base,
    teams: [
      teamFixture(alphaId, "Alpha", "nfl", "football", [reservation]),
      ...base.teams.slice(1),
    ],
  });

  await expect.element(page.getByText("Roster move after")).toBeVisible();
  await expect
    .element(
      page.getByText(
        "Move Casey Moss from BN to IR after the transaction, because only the transaction frees that slot. It is reported as its own step.",
        { exact: true },
      ),
    )
    .toBeVisible();
});

it("submits the included moves once, keeps the action visible on a phone, and shows every result in place", async () => {
  let resolveSubmit: ((data: TransactionReviewData) => void) | undefined;
  const pendingSubmission = new Promise<TransactionReviewData>((resolve) => {
    resolveSubmit = resolve;
  });
  const submittedInputs: Array<{
    readonly set: string;
    readonly include: ReadonlyArray<string>;
    readonly bids: ReadonlyArray<{ readonly item: string; readonly bid: number }>;
  }> = [];
  using _app = setupReviewPage(reviewFixture(), {
    submit: (input) => {
      submittedInputs.push(input);
      return pendingSubmission;
    },
  });

  await page.viewport(390, 844);
  try {
    await page.getByRole("button", { name: "Submit 3 moves" }).click();

    expect(submittedInputs).toHaveLength(1);
    expect(submittedInputs[0]?.bids).toStrictEqual([{ item: waiverItem().id, bid: 25 }]);
    await expect
      .element(page.getByRole("button", { name: "Submit 3 moves" }))
      .toHaveAttribute("aria-busy", "true");
    await expect.element(page.getByText(/Sending now/u)).toBeVisible();
    await expect
      .element(page.getByText(/3 of 4 moves included. 1 waiver claim spends 25 FAAB./u))
      .toBeVisible();
    await expect.element(page.getByRole("checkbox", { name: /Add Sam Rivers/u })).toBeDisabled();

    const panel = document.getElementById("submission-panel");
    expect(panel, "the submission panel").not.toBeNull();
    expect(getComputedStyle(panel ?? document.body).position).toBe("fixed");
    const bounds = panel?.getBoundingClientRect();
    expect(bounds?.top ?? -1).toBeGreaterThanOrEqual(0);
    expect(bounds?.bottom ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(844);

    await captureViewport("submitting-390-light");
    document.documentElement.classList.add("dark");
    await captureViewport("submitting-390-dark");
    document.documentElement.classList.remove("dark");

    resolveSubmit?.({ review: resultFixture(), submittedBids: [] });

    await expect.element(page.getByRole("heading", { name: "Submitted" })).toBeVisible();
    await expect
      .element(
        page.getByText("1 executed · 1 pending on waivers · 1 failed · 1 unknown · 2 skipped."),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByText(/Waivers run later, so this claim is pending rather than done or failed/u),
      )
      .toBeVisible();
    await expect.element(page.getByText(/It was attempted once and not retried/u)).toBeVisible();
    await expect
      .element(page.getByText(/This move may or may not have applied. It was not retried/u))
      .toBeVisible();
    await expect.element(page.getByText("Left out of this submission.")).toBeVisible();
    await expect
      .element(page.getByText("That player is no longer available.", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("Drop Riley Chen", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Executed", { exact: true }).first()).toBeVisible();
    expect(page.getByRole("button", { name: /Submit/u }).elements()).toHaveLength(0);
    expect(page.getByRole("checkbox").elements()).toHaveLength(0);
    await expect.element(page.getByText(/This set stays open while a move/u)).toBeVisible();
    expect(document.activeElement).toBe(document.getElementById("submission-result"));

    await captureViewport("result-390-light");
    document.documentElement.classList.add("dark");
    await captureViewport("result-390-dark");
    document.documentElement.classList.remove("dark");
  } finally {
    document.documentElement.classList.remove("dark");
    await page.viewport(1280, 720);
  }
});

it("offers another submission for a move that has not run while an earlier outcome stays", async () => {
  const base = reviewFixture();
  const replacement: TransactionReviewItemView = {
    ...freeAgentItem(),
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165c9",
    adds: [player("Owen Park", "D", "TOR", "Free agent")],
    reason: "Try the add again.",
  };
  const includes: Array<ReadonlyArray<string>> = [];
  using _app = setupReviewPage(
    {
      ...base,
      set: {
        ...base.set,
        submissions: [{ submittedAt: now, completedAt: now }],
        settled: false,
      },
      teams: [teamFixture(alphaId, "Alpha", "nfl", "football", [failedAddItem(), replacement])],
    },
    {
      submit: (input) => {
        includes.push(input.include);
        return Promise.resolve({ review: base });
      },
    },
  );

  await expect.element(page.getByRole("heading", { name: "Submitted" })).toBeVisible();
  await expect.element(page.getByText(/This set stays open while a move/u)).toBeVisible();
  await expect.element(page.getByText("That player is no longer available.")).toBeVisible();
  await expect
    .element(page.getByRole("checkbox", { name: /Include: Add Owen Park/u }))
    .toBeChecked();
  expect(page.getByRole("checkbox", { name: /Include: Add Mika Olsen/u }).elements()).toHaveLength(
    0,
  );

  await page.getByRole("button", { name: "Submit 1 move" }).click();
  expect(includes).toStrictEqual([[replacement.id]]);
});

it("tells the person what to check when the provider gives no rejection reason", async () => {
  const review = resultFixture();
  const alpha = review.teams[0];
  if (alpha === undefined) {
    throw new Error("the result fixture has an alpha team");
  }
  const item: TransactionReviewItemView = {
    ...failedAddItem(),
    execution: {
      outcome: "failed",
      detail: "The provider rejected the transaction with HTTP 400 without giving a reason.",
      decidedAt: now,
      steps: [],
    },
  };
  using _app = setupReviewPage({ ...review, teams: [{ ...alpha, items: [item] }] });

  await expect.element(page.getByText(/No reason was given/u)).toBeVisible();
  await expect
    .element(page.getByText(/Check the roster and the league's transaction rules/u))
    .toBeVisible();
});

it("keeps the status and the provider's raw words when the refusal is unreadable", async () => {
  const review = resultFixture();
  const alpha = review.teams[0];
  if (alpha === undefined) {
    throw new Error("the result fixture has an alpha team");
  }
  const detail =
    'The provider rejected the transaction with HTTP 400. It said: {"unexpected":{"state":"refused"}}';
  const item: TransactionReviewItemView = {
    ...failedAddItem(),
    execution: { outcome: "failed", detail, decidedAt: now, steps: [] },
  };
  using _app = setupReviewPage({ ...review, teams: [{ ...alpha, items: [item] }] });

  await expect.element(page.getByText(detail)).toBeVisible();
  expect(page.getByText(/No reason was given/u).elements()).toHaveLength(0);
});

it("does not send a submission when every move is left out", async () => {
  let submissions = 0;
  using _app = setupReviewPage(reviewFixture(), {
    submit: () => {
      submissions += 1;
      return Promise.resolve({ review: resultFixture() });
    },
  });

  await page
    .getByRole("checkbox", { name: /Include: Add Sam Rivers and drop Alex Vance/u })
    .click();
  await page
    .getByRole("checkbox", { name: /Include: Add Mika Olsen and drop Tomas Berg/u })
    .click();
  await page.getByRole("checkbox", { name: /Include: Drop Riley Chen/u }).click();
  await expect.element(page.getByText("0 of 4 moves included. No FAAB is spent.")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Submit moves" }))
    .toHaveAttribute("aria-disabled", "true");
  expect(submissions).toBe(0);
});

it("shows a trade as an offer, not a change, with both sides and the league rule", async () => {
  using _app = setupReviewPage(tradeReviewFixture());

  await expect.element(page.getByText("Trade offer", { exact: true })).toBeVisible();
  await expect.element(page.getByText("Offer to Beta", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText("Dana Ruiz decides. We cannot accept or reject on their behalf.", {
        exact: false,
      }),
    )
    .toBeVisible();
  await expect.element(page.getByText("You receive", { exact: true })).toBeVisible();
  await expect.element(page.getByText("You send", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText(/League review: a vote follows if the other manager accepts./u))
    .toBeVisible();
  await expect.element(page.getByText(/Trading closes 2026-11-28./u)).toBeVisible();
  await expect
    .element(page.getByText(/This is an offer, not a change to either roster./u))
    .toBeVisible();
  await expect.element(page.getByText(/An offer, not a change./u)).toBeVisible();
  expect(page.getByText("Pending on waivers").elements()).toHaveLength(0);
  expect(page.getByRole("button", { name: "Withdraw offer" }).elements()).toHaveLength(0);
});

it("withdraws a pending trade from our own record", async () => {
  const requests: Array<{
    readonly team: string;
    readonly item?: string;
    readonly offer?: string;
  }> = [];
  using _app = setupReviewPage(pendingTradeReviewFixture(), {
    withdraw: (input) => {
      requests.push(input);
      return Promise.resolve({
        status: "withdrawn" as const,
        detail: "The provider confirmed the withdrawal and no longer lists the offer.",
      });
    },
  });

  await expect
    .element(page.getByText("Pending with the other manager", { exact: true }))
    .toBeVisible();
  await page.getByRole("button", { name: "Withdraw offer" }).click();
  await expect
    .element(page.getByText("The provider confirmed the withdrawal and no longer lists the offer."))
    .toBeVisible();
  expect(requests).toEqual([{ team: alphaId, item: tradeItemId }]);
});

it("shows a withdrawn trade as ended and offers no second withdrawal", async () => {
  using _app = setupReviewPage(withdrawnTradeReviewFixture());

  await expect.element(page.getByText("Withdrawn", { exact: true })).toBeVisible();
  await expect
    .element(page.getByText("Withdrawn before acceptance. The provider deletes a withdrawn offer."))
    .toBeVisible();
  expect(page.getByRole("button", { name: "Withdraw offer" }).elements()).toHaveLength(0);
});

it("withdraws an offer the agent did not create", async () => {
  const requests: Array<{
    readonly team: string;
    readonly item?: string;
    readonly offer?: string;
  }> = [];
  using _app = setupReviewPage(providerOfferReviewFixture(), {
    withdraw: (input) => {
      requests.push(input);
      return Promise.resolve({
        status: "withdrawn" as const,
        detail: "The provider confirmed the withdrawal and no longer lists the offer.",
      });
    },
  });

  await expect
    .element(page.getByRole("heading", { name: "Offers pending in your league" }))
    .toBeVisible();
  await expect.element(page.getByText("Beta to Delta", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Withdraw offer" }).click();
  expect(requests).toEqual([{ team: betaId, offer: providerOfferRef }]);
});

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

it("captures a trade item, its pending state, and its withdrawn state", async () => {
  const captures = [
    {
      name: "trade-item",
      fixture: tradeReviewFixture,
    },
    {
      name: "trade-pending",
      fixture: pendingTradeReviewFixture,
    },
    {
      name: "trade-withdrawn",
      fixture: withdrawnTradeReviewFixture,
    },
  ] as const;

  try {
    for (const capture of captures) {
      using _app = setupReviewPage(capture.fixture());
      await page.viewport(390, 844);
      await expect.element(page.getByText("Trade offer", { exact: true })).toBeVisible();
      for (const dark of [false, true]) {
        document.documentElement.classList.toggle("dark", dark);
        const fullHeight = Math.max(
          844,
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
        );
        await page.viewport(390, fullHeight);
        await page.screenshot({
          path: `../../../../../.artifacts/trade-proposals/${capture.name}-390-${dark ? "dark" : "light"}.png`,
        });
        await page.viewport(390, 844);
      }
      document.documentElement.classList.remove("dark");
    }
  } finally {
    document.documentElement.classList.remove("dark");
    await page.viewport(1280, 720);
  }
});

async function captureViewport(name: string): Promise<void> {
  const options = { target: "page" } satisfies Parameters<typeof page.screenshot>[0] & {
    readonly target: "page";
  };
  await page.screenshot({
    ...options,
    path: `../../../../../.artifacts/transactions-review/${name}.png`,
  });
}

function resultFixture(): TransactionReviewView {
  return {
    ...reviewFixture(),
    set: {
      ...reviewFixture().set,
      submissions: [{ submittedAt: now, completedAt: now }],
      settled: false,
    },
    teams: [
      teamFixture(alphaId, "Alpha", "nfl", "football", [
        pendingWaiverItem(),
        skippedStaleItem(),
        failedAddItem(),
        unknownDropItem(),
        excludedDropItem(),
      ]),
      teamFixture(betaId, "Beta", "nhl", "hockey", [executedDropItem()]),
      teamFixture(gammaId, "Gamma", "nhl", "hockey", []),
    ],
  };
}

function pendingWaiverItem(): TransactionReviewItemView {
  return {
    ...waiverItem(),
    state: "pending",
    execution: {
      outcome: "pending",
      detail:
        "The provider has not processed this waiver claim yet. It may still be awarded or lost, so this move is pending rather than done.",
      decidedAt: now,
      steps: [
        {
          kind: "add",
          playerName: "Sam Rivers",
          outcome: "pending",
          detail: "The provider has not processed this waiver claim yet.",
          decidedAt: now,
        },
        {
          kind: "drop",
          playerName: "Alex Vance",
          outcome: "pending",
          detail: "The provider has not processed this waiver claim yet.",
          decidedAt: now,
        },
      ],
    },
  };
}

function skippedStaleItem(): TransactionReviewItemView {
  return {
    ...staleItem(),
    state: "skipped",
    execution: {
      outcome: "skipped",
      detail: "Jordan Lee is already rostered in this league, so the add can no longer be made.",
      decidedAt: now,
      steps: [],
    },
  };
}

function failedAddItem(): TransactionReviewItemView {
  return {
    ...freeAgentItem(),
    state: "failed",
    execution: {
      outcome: "failed",
      detail: "That player is no longer available.",
      decidedAt: now,
      steps: [
        {
          kind: "add",
          playerName: "Mika Olsen",
          outcome: "failed",
          detail: "That player is no longer available.",
          decidedAt: now,
        },
      ],
    },
  };
}

function unknownDropItem(): TransactionReviewItemView {
  return {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b5",
    kind: "drop",
    adds: [],
    drops: [player("Owen Park", "D", "TOR")],
    picks: [],
    reason: "This response was lost.",
    state: "unknown",
    staleness: { status: "current", checkedAt: now, reasons: [] },
    execution: {
      outcome: "unknown",
      detail:
        "The provider did not confirm the transaction; it may or may not have applied. It was not retried.",
      decidedAt: now,
      steps: [
        {
          kind: "drop",
          playerName: "Owen Park",
          outcome: "unknown",
          detail:
            "The provider did not confirm the transaction; it may or may not have applied. It was not retried.",
          decidedAt: now,
        },
      ],
    },
  };
}

function excludedDropItem(): TransactionReviewItemView {
  return {
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165b6",
    kind: "drop",
    adds: [],
    drops: [player("Nate Cole", "G", "VGK")],
    picks: [],
    reason: "Left out on purpose.",
    state: "skipped",
    staleness: { status: "current", checkedAt: now, reasons: [] },
    execution: {
      outcome: "skipped",
      detail: "Left out of this submission.",
      decidedAt: now,
      steps: [],
    },
  };
}

function executedDropItem(): TransactionReviewItemView {
  return {
    ...dropItem(),
    state: "executed",
    execution: {
      outcome: "executed",
      decidedAt: now,
      steps: [
        {
          kind: "drop",
          playerName: "Riley Chen",
          outcome: "executed",
          decidedAt: now,
        },
      ],
    },
  };
}

function setupReviewPage(
  review: TransactionReviewView,
  options: {
    readonly submit?: TransactionRemote["submit"];
    readonly withdraw?: TransactionRemote["withdraw"];
  } = {},
): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const remote: TransactionRemote = {
    read: () => Promise.resolve(review),
    submit: options.submit ?? (() => Promise.resolve({ review })),
    withdraw:
      options.withdraw ??
      (() =>
        Promise.resolve({
          status: "withdrawn" as const,
          detail: "The provider confirmed the withdrawal.",
        })),
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
    component: () => (
      <TransactionReviewPage reviewQuery={() => reviewQuery} remote={() => remote} />
    ),
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
    history: createMemoryHistory({ initialEntries: [`/transactions/${review.set.id}`] }),
    routeTree: rootRoute.addChildren([reviewRoute, teamRoute, teamsRoute, accountRoute]),
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
