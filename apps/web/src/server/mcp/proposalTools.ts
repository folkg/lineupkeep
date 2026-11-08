import { AuthService } from "@lineupkeep/backend/auth/Auth";
import type { AuthenticatedAgent } from "@lineupkeep/backend/auth/Auth";
import { fantasyQueryScopes } from "@lineupkeep/backend/connections/QueryScopes";
import {
  PendingTradeOffersInput,
  PendingTradeOffersResult,
  ProposalSetInput,
  ProposalSetReview,
  ProposeTransactionsInput,
  ProposeTransactionsResult,
  TransactionProposals,
  WithdrawProposalItemsInput,
} from "@lineupkeep/backend/connections/TransactionProposals";
import type { ProposalError } from "@lineupkeep/backend/connections/TransactionProposals";
import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import { Tool, Toolkit } from "effect/ai";

import { RequiredScope } from "./toolAuthorization";

const ToolFailure = Schema.Struct({ code: Schema.String, message: Schema.String });

const ProposedTransactions = Schema.Struct({
  set: ProposeTransactionsResult.fields.set,
  created: ProposeTransactionsResult.fields.created,
  extended: ProposeTransactionsResult.fields.extended,
  items: ProposeTransactionsResult.fields.items,
  refused: ProposeTransactionsResult.fields.refused,
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
      "Propose one set of player operations across any of this account's teams for a person to review, and return the set id and one review link. Proposing writes nothing to the league's site: it stores the set and no transaction is submitted. Before it stores anything, the tool reads current roster, league, and player state for every team the request touches and validates every declared item against the set's end state, the roster projected through the order this set would run. An item that cannot run is never stored. It is returned in `refused` with its 1-based position in the request, a plain reason, and what would make it valid; the valid items in the same call are stored as usual, so a client does not resend the good ones. When no item can run, the call refuses and stores nothing. A reason includes an added player who is no longer available, a dropped or moved player no longer on the roster, a destination slot the league does not declare, a set with no operation that frees a roster place, a closed period, a bid above the budget, an illegal roster position, or no order that keeps the team legal. A roster is illegal when a rostered player sits in a slot that accepts none of their published positions, and that can block a transaction even when the move itself is fine. When a slot the set opens accepts that player, Lineupgrade places a roster move in the team's order, before the transaction when the slot is already open or after it when the transaction frees it; a client may instead declare that move itself as a `slot_move`. The slot can be opened by a drop in the same set, including the drop in the same item. If no slot in the set is open, the item is refused and the reason names the choice only the person can make and the drop or slot move that would resolve it. Fix the reason and propose again, or add the missing operation to the same set. Pass `set` with the id of an open set to append these items after its existing ones. A set is open until it has been submitted and every move in it has settled: a move settles when it executed, when its trade offer is no longer available, or when it was skipped for a reason that cannot change. A set whose submission left a move failed, or that was never submitted, is open. Every team that receives an item is validated again against the current roster together with the moves in the set that are still proposed, and that team's stored order is recomputed. A move whose attempt failed or that was skipped is replaced by a new item: proposing that move again in the same set is accepted because the earlier item is a record, not a plan. A settled or expired set refuses new items. If an added item makes an existing unrun item impossible, nothing is stored: the refusal names the existing item to withdraw, and `withdraw_transaction_proposal_items` removes it. Each item names one team, a kind, the players to add and drop, an optional `to` of `active` or `reserve` for an add, an optional `player` for an `activate` or `stash`, an optional FAAB bid, and a required reason. A drop item cannot add or bid, and a free-agent add cannot bid. The client declares intent per team; Lineupgrade chooses the place, the order of each team's moves, the effective date, and the timing. An add joins the active roster unless its `to` says `reserve`. An `activate` names a reserve-list player to bring onto the active roster; a `stash` names an active player to put on a reserve list that accepts their positions. Both name the player with `player`, add and drop nobody, and never name a slot. A reserve add names one player per item, because each player needs their own reserve place. A single-player add, an `activate`, and a `stash` carry a `placement` in the read-back: the place Lineupgrade chose, and one sentence saying why. A player who cannot sit on a reserve list is refused with that reason instead of a slot to pick. Declare a `slot_move` only when a later add or drop needs one specific slot freed, or a person asked for one exact destination; it names its destination and stays available for that. The set read reports the order Lineupgrade chose with a position for every move before submission, and the review says when the league applies the moves. A player the league's site reports as locked cannot be moved on that date. An item that no operation in the set can make legal is refused on its own and does not refuse the rest of the team's plan. A `slot_move` is a same-roster move, not a lineup write: use `set_lineup` to assign the lineup. A `trade` item names `counterparty` (a team reference from the league's teams read), the players going out in `drops`, and the players coming back in `adds`; it carries players only, no bid, and no draft pick. A league's own rules may allow draft picks to be traded, and `get_league` publishes that as `trades.draftPicks`, but the league's site publishes pick trades only on its website and offers no element for a pick in the transaction API Lineupgrade writes through, so this tool cannot propose one. A trade item that carries `picks` is refused with that reason, never silently ignored. A trade is refused when the counterparty is not another team in the same league, a player is not on the roster they would leave, or the league's trade window has closed, and the refusal names the item. Teams with nothing proposed still appear on the review, so the set covers every team this account has. Player references must come from a read of that team's league; a reference from another account or league, a team this account does not have, a player named in both adds and drops, or the same move repeated is refused and named by its position. Repeating the identical set returns the existing set instead of creating a duplicate. A set that has been extended or had a move withdrawn no longer matches its original request, so proposing the original items again creates a new set. A set expires 24 hours after it is created. Use `revalidate_transaction_proposal_set` to check again later, `get_transaction_proposal_set` to read the set back, and `withdraw_transaction_proposal_items` to remove a move that is still proposed. No tool submits, executes, or spends anything: only a signed-in person can submit the moves that are still proposed from the review page, and Lineupgrade sends them in the order it chose. A set that stays open after a submission accepts a replacement item, and the next submission sends only the moves that are still proposed; a move that already ran, failed, or was skipped keeps its outcome. When a submission's items finish, each team whose roster changed gets one lineup run, and the set read reports that run; a lineup run that fails is reported separately and never changes a move's outcome. A submitted trade is a real offer to another manager, who alone decides whether to accept it.",
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
      "Read one transaction proposal set owned by this account: the set, every item grouped by its team, teams that had nothing proposed, and each item's state (proposed, executed, pending on waivers, failed, skipped, or unknown) with its last check and reasons, including an illegal roster position. A set stores only moves that passed the check when they were proposed; a move refused at proposal time was returned to the client and is absent here. Each team with roster moves carries its planned `order`, with a position for every move, saved by the last check, so the sequence is available before submission. Each team's `order` reports the league's roster maximum, the places the team holds now, and the net places its moves free or use; those are roster places, not the slot names of the league's site. A rejected or unsent write carries the exact wording the league's site gave. A set that has been submitted carries every submission in order, with when it started and when its outcomes were recorded, each move's position in the team order it ran in, and the outcome of every step. Each team also carries the lineup run it was given after its items ran and what became of it, if one was needed. A move that stated intent carries its `placement`: the place Lineupgrade chose and why, in one sentence, including an add's active or reserve place and an `activate` or `stash` destination. A move carries `settled`: true when it will not run again because it executed, its trade offer ended, or it was skipped for a reason that cannot change. A failed move keeps its state, its outcome, and the wording the league's site gave, and is replaced by a new item in the same set. A set whose moves have all settled is an audit record and refuses new items; a set whose submission left a move failed, or that still holds a move that has not settled, stays open for a replacement and another submission. The review link is returned beside it. This reads stored proposals only and contacts no league site; use `revalidate_transaction_proposal_set` to re-read current roster, pool, period, and budget state before anyone decides. Another account's set is reported as not found.",
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
      "Re-read the current state at the league's site for one proposal set and mark each open item current, stale, or illegal with its reasons. A set that stays open after a submission is checked the same way: only the moves that are still proposed are checked, and the outcomes of moves that already ran stay as recorded. It reads each team once for its roster, league rules, and the pool state of the players it adds, so a stale item names what changed: a player is no longer available in the pool, the drop or moved player is no longer on the roster, a destination slot the league does not declare, a set with no operation that frees a roster place, the league's period has closed, the bid exceeds the team's remaining FAAB budget, or the league does not use a FAAB budget at all. It validates the team's set as a set: it chooses an order, then walks the items against the roster projected through the earlier ones, so a drop or declared slot move in the same set can make a later add legal. An add that no operation in the set frees a place for stays stale with `roster_full`, and its reason names the missing drop or slot move. An illegal item names a rostered player in a slot that accepts none of their published positions; when a slot the set opens accepts them the order carries a roster move where that slot is open, and when no slot is open it names the choice only the person can make and the drop or slot move that would resolve it in this set. A client may declare that move itself as a `slot_move`. Each team with roster moves also carries its `order` with a position for every move: the sequence Lineupgrade chose so every step stays legal under the league's slots and published roster-change timing, judged against the roster of the date the moves apply. It is shown before submission and read back by `get_transaction_proposal_set`. A `slot_move` is checked against the league's declared slots and the player's eligibility; a locked player cannot move on the effective date. An item that states intent instead carries a `placement`: the place chosen for it, and one sentence saying why. When no order exists, the whole set for that team is refused: every move in it is illegal with a reason naming both operations and the date, and an order Lineupgrade could not decide within its search bound is reported as unresolved rather than refused. A trade item follows the team's roster moves in the published sequence: it changes no roster until the other manager accepts, so it is never interleaved as if it had settled. A team whose state cannot be read marks its own items stale and never hides the other teams. Staleness and illegality are not failures: an item keeps its proposed state and carries the reason. Use `withdraw_transaction_proposal_items` to remove a move that is still proposed and went stale or cannot be made. An expired set refuses rather than re-validating, so nothing stale or illegal can be silently executed.",
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
  Tool.make("withdraw_transaction_proposal_items", {
    description:
      "Withdraw one or more moves that are still proposed from a proposal set, by move reference, and return the set with its recomputed order and review link. The remaining moves that are still proposed are checked again as a set against current roster, league, and player state, so a removal can make another move possible or leave it stale, and each team's order is recomputed from scratch. Removing the last move for a team is allowed; that team then appears with nothing proposed. A move that already ran, is pending, failed, or was skipped cannot be withdrawn: the refusal names the move and its state, and nothing is removed. A set that stayed open after a submission still accepts a withdrawal of a move that is still proposed; a set whose moves have all settled is an audit record and every one of its moves is refused. This reads current state and writes only the stored set; it sends no write to the league's site. Use propose_transactions with this set's id to add a replacement move.",
    parameters: WithdrawProposalItemsInput,
    success: Schema.toCodecJson(ProposalReview),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.reviewTransactions)
    .annotate(Tool.Title, "Withdraw transaction proposal moves")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, false)
    .annotate(Tool.OpenWorld, false),
  Tool.make("get_pending_trade_offers", {
    description:
      "Read the pending trade offers the league's site publishes for one team this account owns, with the proposing and receiving teams, both ends of every player, any traded draft picks, and an opaque reference a signed-in person can use on the review page to withdraw an offer this account made. The result also carries `ownerNote`, the linked team's note from Lineupgrade: owner context, not a league fact. This tool is read-only: Lineupgrade cannot accept, reject, vote, or counter an offer, and the result says so. The league's site publishes only the managing account's own offers, so this never reports another manager's trade traffic. A league's site that publishes no offers resource reports that boundary instead of an empty success.",
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
  agent: AuthenticatedAgent,
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
      const toReview = (review: ProposalSetReview): ProposalReview => ({
        set: review.set,
        teams: review.teams,
        reviewUrl: reviewUrl(review.set.reviewPath),
      });

      return proposalTools.of({
        propose_transactions: (input) =>
          proposals.propose(agent.userId, proposer, input).pipe(
            Effect.map((result): ProposedTransactions => ({
              set: result.set,
              created: result.created,
              extended: result.extended,
              items: result.items,
              refused: result.refused,
              reviewUrl: reviewUrl(result.set.reviewPath),
              detail: result.detail,
            })),
            mapFailure,
          ),
        get_transaction_proposal_set: (input) =>
          proposals.read(agent.userId, input).pipe(Effect.map(toReview), mapFailure),
        revalidate_transaction_proposal_set: (input) =>
          proposals.revalidate(agent.userId, input).pipe(Effect.map(toReview), mapFailure),
        withdraw_transaction_proposal_items: (input) =>
          proposals.withdrawItems(agent.userId, input).pipe(Effect.map(toReview), mapFailure),
        get_pending_trade_offers: (input) =>
          proposals.readPendingOffers(agent.userId, input).pipe(mapFailure),
      });
    }),
  );
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
            "Every move in this proposal set has settled, so it is an audit record and cannot change or be submitted again; propose a fresh set for a new move.",
          );
        case "proposal.submission_in_progress":
          return reject(
            "submission_in_progress",
            "This proposal set is already being submitted, so nothing else was sent. Read it again in a moment to see the outcome.",
          );
        case "proposal.nothing_accepted":
          return reject(
            "nothing_accepted",
            [
              error.detail,
              ...error.refusals.map(
                (refusal) => `Item ${String(refusal.position)}: ${refusal.reason} ${refusal.fix}`,
              ),
              ...error.withdraw.map(
                (entry) => `Withdraw move ${entry.item} (${entry.label}): ${entry.detail}`,
              ),
            ].join(" "),
          );
        case "proposal.items_not_withdrawable":
          return reject(
            "items_not_withdrawable",
            [
              error.detail,
              ...error.items.map(
                (entry) =>
                  `Move ${entry.item}${entry.state === undefined ? "" : ` (${entry.state})`}: ${entry.detail}`,
              ),
            ].join(" "),
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
