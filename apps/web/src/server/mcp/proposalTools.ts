import { AuthService } from "@lineupkeep/backend/auth/Auth";
import type { AuthenticatedAgent } from "@lineupkeep/backend/auth/Auth";
import { providerSessionRefusal } from "@lineupkeep/backend/connections/Connection";
import { TeamId } from "@lineupkeep/backend/connections/FantasyTeam";
import { fantasyQueryScopes } from "@lineupkeep/backend/connections/QueryScopes";
import {
  PendingTradeOffersInput,
  PendingTradeOffersResult,
  TransactionOffers,
} from "@lineupkeep/backend/connections/TransactionOffers";
import type { TransactionOffersError } from "@lineupkeep/backend/connections/TransactionOffers";
import {
  ListTransactionMovesInput,
  ProposeTransactionMovesInput,
  TransactionMoveId,
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

const DiscardTransactionMoveToolInput = Schema.Struct({
  team: TeamId,
  move: TransactionMoveId.annotate({ description: "The saved move to discard." }),
  reason: Schema.optional(Schema.NonEmptyString).annotate({
    description: "Why you are discarding it; returned with the result.",
  }),
});

const DiscardedTransactionPlan = Schema.Struct({
  team: TransactionMoveTeam,
  today: Schema.optional(StoredMoveDate),
  moves: Schema.Array(TransactionMoveRead),
  days: Schema.Array(TransactionPlanDay),
  refused: Schema.Array(PlanRefusal),
  reason: Schema.optional(Schema.NonEmptyString),
});

export const proposalTools = Toolkit.make(
  Tool.make("propose_transactions", {
    description:
      "Add moves to one team's transaction queue, or change a saved move in place by naming its move id. A saved move is discarded with `discard_transaction_move`. Proposals are stored only: nothing reaches the league's site or is submitted, executed, or spent. A move that cannot run is returned in `refused` with its position and reason and is not stored.",
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
      "Read one team's transaction queue in order, grouped by run day, with every move's stored validation and the time it was checked. It reads stored state and checks the moves against the team's current roster, reporting its places and each reserve list by the league's own name.",
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
  Tool.make("discard_transaction_move", {
    description:
      "Discard one saved move from a team's queue and return the plan, which stays open with its other moves. A move that already ran is refused, and the refusal says why.",
    parameters: DiscardTransactionMoveToolInput,
    success: Schema.toCodecJson(DiscardedTransactionPlan),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.reviewTransactions)
    .annotate(Tool.Title, "Discard a transaction move")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, false)
    .annotate(Tool.OpenWorld, false),
);

export function proposalToolHandlers(
  agent: AuthenticatedAgent,
): Layer.Layer<
  Tool.HandlersFor<Toolkit.Tools<typeof proposalTools>>,
  never,
  TransactionPlanService | TransactionOffers | AuthService
> {
  return proposalTools.toLayer(
    Effect.gen(function* () {
      const plans = yield* TransactionPlanService;
      const offers = yield* TransactionOffers;
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
                ...(move.move === undefined ? {} : { move: move.move }),
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
          offers.readPendingOffers(agent.userId, input).pipe(mapOfferFailure),
        list_transaction_proposals: (input) => plans.list(agent.userId, input).pipe(mapPlanFailure),
        get_transaction_plan: (input) => plans.plan(agent.userId, input).pipe(mapPlanFailure),
        discard_transaction_move: (input) =>
          plans.discard(agent.userId, { team: input.team, move: input.move }).pipe(
            Effect.flatMap((result) =>
              plans.plan(agent.userId, { team: input.team }).pipe(
                Effect.map((plan) => ({
                  ...plan,
                  refused: result.refused,
                  ...(input.reason === undefined ? {} : { reason: input.reason }),
                })),
              ),
            ),
            mapPlanFailure,
          ),
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

function mapOfferFailure<A>(
  program: Effect.Effect<A, TransactionOffersError>,
): Effect.Effect<A, { code: string; message: string }, never> {
  return program.pipe(
    Effect.catch((error) => {
      switch (error._tag) {
        case "transaction_offers.team_not_found":
          return reject(
            "team_not_found",
            "The selected team is not available to this account. List your teams and try again.",
          );
        case "transaction_offers.connection_not_ready":
          return reject("connection_not_ready", providerSessionRefusal(error.status));
        case "transaction_offers.provider_unavailable":
          return reject("provider_unavailable", error.detail);
        case "transaction_offers.persistence_failed":
          return reject(
            "offers_unavailable",
            "The pending offers could not be read. Try again in a moment.",
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
