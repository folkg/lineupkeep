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
      "Propose one set of player transactions across any of this account's teams for a person to review, and return the set id and one review link. Proposing writes nothing to the provider: it stores the set and returns per-item state, and no transaction is submitted. Each item names one team, a kind, the players to add and drop, an optional FAAB bid, and a required reason. `free_agent_add` adds players with no bid, `waiver_claim` adds players with a bid of 0 or more, and `drop` only drops; a drop item cannot add or bid, and a free-agent add cannot bid. Teams with nothing proposed still appear on the review, so the set covers every team this account has. Player references must come from a read of that team's league; a reference from another account or league, a team this account does not have, a player named in both adds and drops, or the same move repeated is refused and named by its position. Repeating the identical set returns the existing set instead of creating a duplicate. A set expires 24 hours after it is created, and the review re-reads current state before anyone decides: use `revalidate_transaction_proposal_set` for that, and `get_transaction_proposal_set` to read the set back.",
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
      "Read one transaction proposal set owned by this account: the set, every item grouped by its team, teams that had nothing proposed, and each item's state (proposed, approved, executed, failed, or skipped) with its last staleness check and reasons. The review link is returned beside it. This reads stored proposals only and contacts no provider; use `revalidate_transaction_proposal_set` to re-read current roster, pool, period, and budget state before anyone decides. Another account's set is reported as not found.",
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
      "Re-read current provider state for one proposal set and mark each open item current or stale with its reasons. It reads each team once for its roster, league rules, and the pool state of the players it adds, so a stale item names what changed: a player is no longer available in the pool, the drop is no longer on the roster, the roster would be over its declared capacity, the league's period has closed, the bid exceeds the team's remaining FAAB budget, or the league does not use a FAAB budget at all. A team whose state cannot be read marks its own items stale and never hides the other teams. Staleness is not a failure: an item keeps its proposed state and carries the reason. An expired set refuses rather than re-validating, so nothing stale can be silently executed.",
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
      "Read the pending trade offers the provider publishes for one team this account owns, with the proposing and receiving teams, both ends of every player, and any traded draft picks. This is read-only: Lineupkeep cannot accept, reject, cancel, or propose a trade in this product, and the result says so. The provider publishes only the managing account's own offers, so this never reports another manager's trade traffic. A provider that publishes no offers resource reports that boundary instead of an empty success.",
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

function mapFailure<A>(
  program: Effect.Effect<A, ProposalError>,
): Effect.Effect<A, { code: string; message: string }, never> {
  return program.pipe(
    Effect.catch((error) => {
      switch (error._tag) {
        case "proposal.content_invalid":
          return reject("content_invalid", error.detail);
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
            "This proposal set expired and refuses re-validation rather than executing stale moves. Propose the transactions again to create a fresh set.",
          );
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
