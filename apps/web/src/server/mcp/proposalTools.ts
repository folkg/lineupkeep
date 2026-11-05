import { AuthService } from "@lineupkeep/backend/auth/Auth";
import type { UserId } from "@lineupkeep/backend/auth/User";
import { fantasyQueryScopes } from "@lineupkeep/backend/connections/QueryScopes";
import {
  PendingTradeOffersInput,
  PendingTradeOffersResult,
  ProposalSetInput,
  ProposalSetReview,
  ProposeTransactionsInput,
  ProposeTransactionsResult,
  TransactionProposals,
} from "@lineupkeep/backend/connections/TransactionProposals";
import type { ProposalError } from "@lineupkeep/backend/connections/TransactionProposals";
import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import { Tool, Toolkit } from "effect/ai";

import { RequiredScope } from "./toolAuthorization";

const ToolFailure = Schema.Struct({ code: Schema.String, message: Schema.String });

const ProposedTransactions = Schema.Struct({
  set: ProposeTransactionsResult.fields.set,
  created: Schema.Boolean,
  items: ProposeTransactionsResult.fields.items,
  reviewUrl: Schema.NonEmptyString,
  detail: Schema.NonEmptyString,
});
type ProposedTransactions = typeof ProposedTransactions.Type;

const ProposalReview = Schema.Struct({
  set: ProposalSetReview.fields.set,
  teams: ProposalSetReview.fields.teams,
  reviewUrl: Schema.NonEmptyString,
});
type ProposalReview = typeof ProposalReview.Type;

export const proposalTools = Toolkit.make(
  Tool.make("propose_transactions", {
    description:
      "Propose one set of player operations across any of this account's teams for a person to review, and return the set id and one review link. Proposing writes nothing to the provider: it stores the set and no transaction is submitted. Before returning, the tool reads current roster, league, and player state for every team, so each accepted item carries `current`, `stale`, or `illegal` with the reasons. A stale item is not executable: it names what changed, including an added player who is no longer available, a moved or dropped player no longer on the roster, a destination slot the league does not declare, a roster that would exceed its capacity, a closed period, or a bid above the budget. A roster is illegal when a rostered player sits in a slot that does not accept his positions, and that can block a transaction even when the move itself is fine. When an open legal slot accepts that player, the server places a roster move in the team's order before the transaction; a client may instead declare that move itself as a `slot_move`. If no legal slot is open, the item names the choice only the person can make. Fix the reason and propose again. Each item names one team, a kind, the players to add and drop or the `slotMove` of a `slot_move`, an optional FAAB bid, and a required reason. The kinds a client can declare are `free_agent_add` (players added, no bid), `waiver_claim` (players added with a bid of 0 or more), `drop` (players dropped only), `slot_move` (one rostered player moved to one slot the league declares, whether starting, bench, or reserve, into a reserve slot or back out of one), and `trade` (players going out and coming back with one counterparty). A drop item cannot add or bid, and a free-agent add cannot bid. The client declares intent per team; the server owns the order of each team's moves, the effective date, and the timing. A `slot_move` names `slotMove.player` (a player reference from a roster read) and `slotMove.toSlot` (a slot the league declares). It adds and drops nobody, carries no bid, and names no counterparty. Declare one when a later add or drop needs a specific slot freed or a player on a reserve list should be activated, and never state which operation comes first. The server places every move in the order where the roster stays legal under the league's slot rules and published roster-change timing, and the review shows that order. A player the provider reports as locked cannot be moved on that date. When no order keeps the team legal, the whole set for that team is refused at this check: every move in it is marked illegal, the review names the operations that conflict in plain words, and nothing is sent. A `slot_move` is a same-roster move, not a lineup write: use `set_lineup` to assign the lineup. A `trade` item names `counterparty` (a team reference from the league's teams read), the players going out in `drops`, and the players coming back in `adds`; it carries players only, no bid, and no draft pick. A league's own rules may allow draft picks to be traded, and `get_league` publishes that as `trades.draftPicks`, but the provider publishes pick trades only on its website and offers no element for a pick in the transaction API Lineupkeep writes through, so this tool cannot propose one. A trade item that carries `picks` is refused with that reason, never silently ignored. A trade is refused when the counterparty is not another team in the same league, a player is not on the roster they would leave, or the league's trade window has closed, and the refusal names the item. Teams with nothing proposed still appear on the review, so the set covers every team this account has. Player references must come from a read of that team's league; a reference from another account or league, a team this account does not have, a player named in both adds and drops, or the same move repeated is refused and named by its position. Repeating the identical set returns the existing set instead of creating a duplicate. A set expires 24 hours after it is created. Use `revalidate_transaction_proposal_set` to check again later, and `get_transaction_proposal_set` to read the set back. No tool submits, executes, or spends anything: only a signed-in person can submit the included moves from the review page, and the server sends them in the order it chose. A submitted trade is a real offer to another manager, who alone decides whether to accept it.",
    parameters: ProposeTransactionsInput,
    success: Schema.toCodecJson(ProposedTransactions),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.reviewTransactions)
    .annotate(Tool.Title, "Propose transactions for review")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("get_transaction_proposal_set", {
    description:
      "Read one transaction proposal set owned by this account: the set, every item grouped by its team, teams that had nothing proposed, and each item's state (proposed, executed, pending on waivers, failed, skipped, or unknown) with its last check and reasons, including an illegal roster position. A `slot_move` item carries `slotMove` with its player and destination slot. A rejected or unsent write carries the provider's exact wording when it gave one. A submitted set also carries who submitted it, when, each move's position in its team's order, and the outcome of every step, and cannot be submitted again. The review link is returned beside it. This reads stored proposals only and contacts no provider; use `revalidate_transaction_proposal_set` to re-read current roster, pool, period, and budget state before anyone decides. Another account's set is reported as not found.",
    parameters: ProposalSetInput,
    success: Schema.toCodecJson(ProposalReview),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.reviewTransactions)
    .annotate(Tool.Title, "Read a transaction proposal set")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("revalidate_transaction_proposal_set", {
    description:
      "Re-read current provider state for one proposal set and mark each open item current, stale, or illegal with its reasons. It reads each team once for its roster, league rules, and the pool state of the players it adds, so a stale item names what changed: a player is no longer available in the pool, the drop or moved player is no longer on the roster, a destination slot the league does not declare, the roster would be over its declared capacity, the league's period has closed, the bid exceeds the team's remaining FAAB budget, or the league does not use a FAAB budget at all. An illegal item names a rostered player in a slot that does not accept him; when an open legal slot accepts him the server's order carries a roster move before the transaction, and when no slot is open it names the choice only the person can make. A client may declare that move itself as a `slot_move`. Each team also carries its `order`: the sequence the server chose so every step stays legal under the league's slots and published roster-change timing. A `slot_move` is checked against the league's declared slots and the player's eligibility; a locked player cannot move on the effective date. When no order exists, the whole set for that team is refused: every move in it is illegal with a reason naming both operations and the date, and an order the server could not decide within its search bound is reported as unresolved rather than refused. A trade item is not part of the order: it changes no roster until the other manager accepts, so it is never sequenced as if it had settled. A team whose state cannot be read marks its own items stale and never hides the other teams. Staleness and illegality are not failures: an item keeps its proposed state and carries the reason. An expired set refuses rather than re-validating, so nothing stale or illegal can be silently executed.",
    parameters: ProposalSetInput,
    success: Schema.toCodecJson(ProposalReview),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.reviewTransactions)
    .annotate(Tool.Title, "Revalidate a transaction proposal set")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("get_pending_trade_offers", {
    description:
      "Read the pending trade offers the provider publishes for one team this account owns, with the proposing and receiving teams, both ends of every player, any traded draft picks, and an opaque reference a signed-in person can use on the review page to withdraw an offer this account made. The result also carries `ownerNote`, the linked team's note from Lineupkeep: it is owner context, not a provider or league fact, and can explain keepers, dynasty cost, salary, or why a player is held before an offer is evaluated. This tool is read-only: Lineupkeep cannot accept, reject, vote, or counter an offer, and the result says so. The provider publishes only the managing account's own offers, so this never reports another manager's trade traffic. A provider that publishes no offers resource reports that boundary instead of an empty success.",
    parameters: PendingTradeOffersInput,
    success: Schema.toCodecJson(PendingTradeOffersResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "Read pending trade offers")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
);

export function proposalToolHandlers(
  userId: UserId,
): Layer.Layer<
  Tool.HandlersFor<Toolkit.Tools<typeof proposalTools>>,
  never,
  TransactionProposals | AuthService
> {
  return proposalTools.toLayer(
    Effect.gen(function* () {
      const proposals = yield* TransactionProposals;
      const auth = yield* AuthService;
      const proposer = { kind: "agent", reference: "mcp", surface: "mcp" } as const;
      const reviewUrl = (path: string): string => new URL(path, auth.oauthResource).href;

      return proposalTools.of({
        propose_transactions: (input) =>
          proposals.propose(userId, proposer, input).pipe(
            Effect.flatMap((result) =>
              proposals
                .revalidate(userId, { set: result.set.id })
                .pipe(Effect.map((review) => revalidatedProposal(result, review))),
            ),
            Effect.map((result): ProposedTransactions => ({
              set: result.set,
              created: result.created,
              items: result.items,
              reviewUrl: reviewUrl(result.set.reviewPath),
              detail: result.detail,
            })),
            mapFailure,
          ),
        get_transaction_proposal_set: (input) =>
          proposals.read(userId, input).pipe(
            Effect.map((review): ProposalReview => ({
              set: review.set,
              teams: review.teams,
              reviewUrl: reviewUrl(review.set.reviewPath),
            })),
            mapFailure,
          ),
        revalidate_transaction_proposal_set: (input) =>
          proposals.revalidate(userId, input).pipe(
            Effect.map((review): ProposalReview => ({
              set: review.set,
              teams: review.teams,
              reviewUrl: reviewUrl(review.set.reviewPath),
            })),
            mapFailure,
          ),
        get_pending_trade_offers: (input) =>
          proposals.readPendingOffers(userId, input).pipe(mapFailure),
      });
    }),
  );
}

function revalidatedProposal(
  result: ProposeTransactionsResult,
  review: ProposalSetReview,
): ProposeTransactionsResult {
  const byId = new Map(
    review.teams.flatMap((team) => team.items).map((item) => [item.id, item] as const),
  );
  const items = result.items.map((entry) =>
    entry.outcome === "accepted"
      ? { ...entry, item: byId.get(entry.item.id) ?? entry.item }
      : entry,
  );
  let stale = 0;
  let illegal = 0;
  for (const entry of items) {
    if (entry.outcome !== "accepted") {
      continue;
    }
    if (entry.item.staleness.status === "stale") {
      stale += 1;
    }
    if (entry.item.staleness.status === "illegal") {
      illegal += 1;
    }
  }
  const notes = [
    ...(stale === 0
      ? []
      : [
          `${String(stale)} accepted ${stale === 1 ? "item is" : "items are"} stale and names why.`,
        ]),
    ...(illegal === 0
      ? []
      : [
          `${String(illegal)} accepted ${illegal === 1 ? "item is" : "items are"} illegal and names the player, the slot, and the choice that resolves it.`,
        ]),
  ];
  const conflicts = review.teams.flatMap((team) =>
    team.order?.status === "conflict" ? team.order.conflicts.map((entry) => entry.detail) : [],
  );
  const refused =
    conflicts.length === 0
      ? []
      : [
          `No order keeps one team's moves legal, so that team's whole set is refused at this check: ${conflicts.join(" ")}`,
        ];
  return {
    ...result,
    items,
    detail: `${result.detail} ${
      notes.length === 0 ? "Every accepted item is current." : notes.join(" ")
    }${refused.length === 0 ? "" : ` ${refused.join(" ")}`}`,
  };
}

function mapFailure<A>(
  program: Effect.Effect<A, ProposalError>,
): Effect.Effect<A, { code: string; message: string }, never> {
  return program.pipe(
    Effect.catch((error) => {
      switch (error._tag) {
        case "proposal.content_invalid":
          return reject("content_invalid", error.detail);
        case "proposal.nothing_included":
          return reject("nothing_included", error.detail);
        case "proposal.already_submitted":
          return reject(
            "already_submitted",
            "This proposal set was already submitted. It is an audit record now and cannot be submitted again; propose a fresh set for a new move.",
          );
        case "proposal.nothing_accepted":
          return reject(
            "nothing_accepted",
            `${error.detail} ${error.refusals
              .map((refusal) => `Item ${String(refusal.index + 1)}: ${refusal.detail}`)
              .join(" ")}`.trim(),
          );
        case "proposal.set_not_found":
          return reject(
            "set_not_found",
            "The selected proposal set is not available to this account. Propose the set again or read your own set id.",
          );
        case "proposal.set_expired":
          return reject(
            "set_expired",
            "This proposal set expired and refuses re-validation rather than executing stale or illegal moves. Propose the transactions again to create a fresh set.",
          );
        case "proposal.trade_not_found":
          return reject(
            "trade_not_found",
            "That trade proposal is not available to this account. Reload the review and try again.",
          );
        case "proposal.trade_not_pending":
          return reject("trade_not_pending", error.detail);
        case "proposal.team_not_found":
          return reject(
            "team_not_found",
            "The selected team is not available to this account. List your teams and try again.",
          );
        case "proposal.connection_not_ready":
          return reject(
            "connection_not_ready",
            "The selected team's connection is not ready. Reconnect it and read the offers again.",
          );
        case "proposal.provider_unavailable":
          return reject("provider_unavailable", error.detail);
        case "proposal.persistence_failed":
          return Effect.annotateCurrentSpan({
            "app.outcome": "failure",
            "error.type": error._tag,
          }).pipe(
            Effect.andThen(
              Effect.die(new Error("The proposal could not be stored or read. Try again.")),
            ),
          );
      }
    }),
  );
}

function reject(
  code: string,
  message: string,
): Effect.Effect<never, { code: string; message: string }, never> {
  return Effect.annotateCurrentSpan({ "app.outcome": "rejected", "error.type": code }).pipe(
    Effect.andThen(Effect.fail({ code, message })),
  );
}
