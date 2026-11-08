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
      "Propose a set of player moves across this account's teams for a person to review, and return the set and a review link. It stores proposals only: nothing is sent to the league's site, and no tool submits, executes, or spends. Each item that cannot run returns in `refused` with its request position, reason, and fix, and is not stored.",
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
      "Read one stored proposal set: its items by team with state, last check, planned order, and submissions. It reads stored state only and contacts no league site; another account's set is not found.",
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
      "Re-check one proposal set against current league state and mark each open item current, stale, or illegal with reasons. Staleness is not failure: items stay proposed and the ordered plan is recomputed.",
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
      "Withdraw still-proposed moves from one set and return it with its order recomputed. A move that already ran, is pending, failed, or was skipped cannot be withdrawn.",
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
      "Pending trade offers the league's site publishes for one team you own, each with its reference. Read-only: nothing here can accept, reject, vote on, or counter an offer.",
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
