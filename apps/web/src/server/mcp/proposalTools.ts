import { AuthService } from "@lineupkeep/backend/auth/Auth";
import type { AuthenticatedAgent } from "@lineupkeep/backend/auth/Auth";
import { providerSessionRefusal } from "@lineupkeep/backend/connections/Connection";
import { TeamId } from "@lineupkeep/backend/connections/FantasyTeam";
import { fantasyQueryScopes } from "@lineupkeep/backend/connections/QueryScopes";
import {
  ListTransactionMovesInput,
  ProposeTransactionMovesInput,
  TransactionMoveList,
  TransactionMoveRead,
  TransactionMoveTeam,
  TransactionPlanDay,
  TransactionPlanInput,
  TransactionPlanRead,
  TransactionPlanService,
  StoredMoveDate,
} from "@lineupkeep/backend/connections/TransactionPlans";
import type { TransactionPlanServiceError } from "@lineupkeep/backend/connections/TransactionPlans";
import {
  PendingTradeOffersInput,
  PendingTradeOffersResult,
  TransactionProposals,
} from "@lineupkeep/backend/connections/TransactionProposals";
import type { ProposalError } from "@lineupkeep/backend/connections/TransactionProposals";
import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import { Tool, Toolkit } from "effect/ai";

import { RequiredScope } from "./toolAuthorization";

const ToolFailure = Schema.Struct({ code: Schema.String, message: Schema.String });

const PlanRefusal = Schema.Struct({
  code: Schema.String,
  team: TeamId,
  detail: Schema.String,
  group: Schema.optional(Schema.String),
  moves: Schema.Array(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});

const ProposedTransactions = Schema.Struct({
  team: TransactionMoveTeam,
  today: Schema.optional(StoredMoveDate),
  moves: Schema.Array(TransactionMoveRead),
  days: Schema.Array(TransactionPlanDay),
  refused: Schema.Array(PlanRefusal),
});

export const proposalTools = Toolkit.make(
  Tool.make("propose_transactions", {
    description:
      "Add moves to one team's single transaction queue, returning that team's plan and any refused moves. Proposals are stored only: nothing reaches the league's site, nothing is submitted, executed, or spent. A move that cannot run is returned in `refused` with its position and reason and is not stored. A saved move is changed by saving it again or discarding it.",
    parameters: ProposeTransactionMovesInput,
    success: Schema.toCodecJson(ProposedTransactions),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.reviewTransactions)
    .annotate(Tool.Title, "Propose transactions")
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
  Tool.make("list_transaction_proposals", {
    description:
      "List open moves across the account's teams, today first, grouped by run day and team. Filter by one team and by state: `today`, `saved`, or `ended`. The read carries each move's stored check and the time it was checked, and the open, today, saved, and ended totals.",
    parameters: ListTransactionMovesInput,
    success: Schema.toCodecJson(TransactionMoveList),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "List transaction moves")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("get_transaction_plan", {
    description:
      "Read one team's transaction queue in order, grouped by run day, with every move's stored validation and the time it was checked. It reads stored state and checks the moves against the team's current roster.",
    parameters: TransactionPlanInput,
    success: Schema.toCodecJson(TransactionPlanRead),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "Read a team's transaction plan")
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
  TransactionPlanService | TransactionProposals | AuthService
> {
  return proposalTools.toLayer(
    Effect.gen(function* () {
      const plans = yield* TransactionPlanService;
      const proposals = yield* TransactionProposals;
      const proposer = { kind: "agent", reference: "mcp", surface: "mcp" } as const;

      return proposalTools.of({
        propose_transactions: (input) =>
          plans
            .proposeRefs(agent.userId, {
              team: input.team,
              proposedBy: {
                ...proposer,
                ...(input.client === undefined || input.client === null
                  ? {}
                  : { client: input.client }),
              },
              moves: input.moves.map((move) => ({
                ...(move.group === undefined ? {} : { group: move.group }),
                kind: move.kind,
                adds: move.adds,
                ...(move.fallbacks === undefined || move.fallbacks === null
                  ? {}
                  : { fallbacks: move.fallbacks }),
                drops: move.drops,
                ...(move.to === undefined || move.to === null ? {} : { to: move.to }),
                ...(move.player === undefined || move.player === null
                  ? {}
                  : { player: move.player }),
                ...(move.slotMove === undefined || move.slotMove === null
                  ? {}
                  : { slotMove: move.slotMove }),
                ...(move.picks === undefined || move.picks === null ? {} : { picks: move.picks }),
                ...(move.counterparty === undefined || move.counterparty === null
                  ? {}
                  : { counterparty: move.counterparty }),
                ...(move.bid === undefined || move.bid === null ? {} : { bid: move.bid }),
                reason: move.reason,
                ...(move.window === undefined || move.window === null
                  ? {}
                  : { runDay: move.window }),
              })),
            })
            .pipe(
              Effect.flatMap((result) =>
                plans
                  .plan(agent.userId, { team: input.team })
                  .pipe(Effect.map((plan) => ({ ...plan, refused: result.refused }))),
              ),
              mapPlanFailure,
            ),
        get_pending_trade_offers: (input) =>
          proposals.readPendingOffers(agent.userId, input).pipe(mapProposalFailure),
        list_transaction_proposals: (input) => plans.list(agent.userId, input).pipe(mapPlanFailure),
        get_transaction_plan: (input) => plans.plan(agent.userId, input).pipe(mapPlanFailure),
      });
    }),
  );
}

function mapPlanFailure<A>(
  program: Effect.Effect<A, TransactionPlanServiceError>,
): Effect.Effect<A, { code: string; message: string }, never> {
  return program.pipe(
    Effect.catch((error) => {
      switch (error._tag) {
        case "transaction_plan.facts_unavailable":
          return reject("state_unavailable", error.detail);
        case "transaction_plan.team_not_found":
          return reject(
            "team_not_found",
            "The selected team is not available to this account. List your teams and try again.",
          );
        case "transaction_plan.move_not_found":
          return reject(
            "move_not_found",
            "The selected move is not available to this account. Read the plan again and try another move.",
          );
        case "transaction_plan.run_in_progress":
          return reject(
            "run_in_progress",
            "This team's plan is running, so nothing else was sent. Read it again in a moment to see the outcome.",
          );
        case "transaction_plan.persistence_failed":
          return reject(
            "plan_unavailable",
            "The plan could not be read or stored. Try again, or start again from the first page.",
          );
      }
    }),
  );
}

function mapProposalFailure<A>(
  program: Effect.Effect<A, ProposalError>,
): Effect.Effect<A, { code: string; message: string }, never> {
  return program.pipe(
    Effect.catch((error) => {
      switch (error._tag) {
        case "proposal.team_not_found":
          return reject(
            "team_not_found",
            "The selected team is not available to this account. List your teams and try again.",
          );
        case "proposal.connection_not_ready":
          return reject("connection_not_ready", providerSessionRefusal(error.status));
        case "proposal.provider_unavailable":
          return reject("provider_unavailable", error.detail);
        case "proposal.persistence_failed":
          return reject(
            "offers_unavailable",
            "The pending offers could not be read. Try again in a moment.",
          );
        case "proposal.content_invalid":
          return reject("content_invalid", error.detail);
        case "proposal.nothing_included":
          return reject("nothing_included", error.detail);
        case "proposal.set_closed":
          return reject("set_closed", error.detail);
        case "proposal.submission_in_progress":
          return reject("submission_in_progress", "This plan is already running.");
        case "proposal.nothing_accepted":
          return reject("nothing_accepted", error.detail);
        case "proposal.items_not_open":
          return reject("items_not_open", error.detail);
        case "proposal.set_not_found":
          return reject("set_not_found", "The selected plan is not available to this account.");
        case "proposal.trade_not_found":
          return reject("trade_not_found", "That trade proposal is not available.");
        case "proposal.trade_not_pending":
          return reject("trade_not_pending", error.detail);
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
