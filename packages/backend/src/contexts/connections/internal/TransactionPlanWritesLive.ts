import { Effect, Layer } from "effect";

import { rosterChangeDate } from "#contexts/connections/ProposalOrder.ts";
import type {
  ProviderLeagueSettings,
  ProviderRosterCoverage,
  ProviderTradeProposalResult,
  ProviderWriteResult,
} from "#contexts/connections/Provider.ts";
import { sessionEvidenceOf } from "#contexts/connections/Provider.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import { loadTeamContext, providerIdentity } from "./QueryContext.ts";
import type { TeamContext } from "./QueryContext.ts";
import { QueryRepository } from "./QueryRepository.ts";
import type {
  TransactionPlanWriteRequest,
  TransactionPlanWriteResult,
} from "./TransactionPlanWrites.ts";
import { TransactionPlanWrites } from "./TransactionPlanWrites.ts";

export const TransactionPlanWritesLive = Layer.effect(
  TransactionPlanWrites,
  Effect.gen(function* () {
    const queries = yield* QueryRepository;
    const encryption = yield* ConnectionCredentialEncryption;
    const registry = yield* ProviderRegistry;

    const apply = Effect.fn("TransactionPlanWrites.apply")(function* (
      request: TransactionPlanWriteRequest,
    ) {
      const loaded = yield* Effect.result(
        loadTeamContext(queries, encryption, registry, request.userId, request.team),
      );
      if (loaded._tag === "Failure") {
        return {
          status: "retry",
          detail: "This team's connection could not be read, so nothing was sent.",
        } satisfies TransactionPlanWriteResult;
      }
      const context = loaded.success;
      const league = yield* Effect.result(
        context.provider.readLeague({
          ...providerIdentity(context),
          providerLeagueKey: context.owned.team.providerLeagueKey,
          sport: context.owned.team.sport,
        }),
      );
      if (league._tag === "Failure") {
        yield* recordRejection(queries, context, league.failure);
        return {
          status: "retry",
          detail: "Your league could not be read, so nothing was sent.",
        } satisfies TransactionPlanWriteResult;
      }
      switch (request.kind) {
        case "trade":
          return yield* tradeOf({ queries, context, request, league: league.success });
        case "activate":
        case "stash":
        case "slot_move":
          return yield* slotMoveOf({ queries, context, request, league: league.success });
        case "free_agent_add":
        case "waiver_claim":
        case "drop":
          return yield* transactionOf({ queries, context, request, league: league.success });
      }
    });

    return { apply };
  }),
);

function transactionOf(input: {
  readonly queries: QueryRepository["Service"];
  readonly context: TeamContext;
  readonly request: TransactionPlanWriteRequest;
  readonly league: ProviderLeagueSettings;
}): Effect.Effect<TransactionPlanWriteResult> {
  return Effect.gen(function* () {
    const transaction = yield* writeResult(
      input.queries,
      input.context,
      input.context.provider.applyTransaction({
        ...providerIdentity(input.context),
        providerLeagueKey: input.league.providerLeagueKey,
        providerTeamKey: input.context.owned.team.providerTeamKey,
        adds: input.request.adds,
        drops: input.request.drops,
        faabBid: input.request.kind === "waiver_claim" ? input.request.bid : undefined,
      }),
    );
    if (transaction.status === "accepted") {
      if (input.request.kind === "waiver_claim") {
        return {
          status: "pending",
          detail: "The league will process this claim.",
        } satisfies TransactionPlanWriteResult;
      }
      return yield* reserveAfterAdd(input);
    }
    return outcomeOf(transaction, "transaction");
  });
}

function reserveAfterAdd(input: {
  readonly queries: QueryRepository["Service"];
  readonly context: TeamContext;
  readonly request: TransactionPlanWriteRequest;
  readonly league: ProviderLeagueSettings;
}): Effect.Effect<TransactionPlanWriteResult> {
  if (input.request.intent?.to !== "reserve") {
    return Effect.succeed({ status: "executed" });
  }
  const placement = input.request.placement;
  const player = placement?.playerKey ?? input.request.adds[0];
  const slot = placement?.toSlot;
  if (player === undefined || slot === undefined) {
    return Effect.succeed({
      status: "unknown",
      detail: "The add reached your league, but no reserve place was named for it.",
    });
  }
  const coverage = coverageOf(input.league);
  if (coverage === undefined) {
    return Effect.succeed({
      status: "unknown",
      detail:
        "The add reached your league, but the league publishes no current period to place the player in reserve.",
    });
  }
  return reserveMoveOf({ ...input, player, slot, coverage });
}

function slotMoveOf(input: {
  readonly queries: QueryRepository["Service"];
  readonly context: TeamContext;
  readonly request: TransactionPlanWriteRequest;
  readonly league: ProviderLeagueSettings;
}): Effect.Effect<TransactionPlanWriteResult> {
  return Effect.gen(function* () {
    const coverage = coverageOf(input.league);
    if (coverage === undefined) {
      return {
        status: "failed",
        detail:
          "The league publishes no current date or scoring week, so the slot move could not be sent.",
      } satisfies TransactionPlanWriteResult;
    }
    const player =
      input.request.slotMove?.playerKey ??
      input.request.placement?.playerKey ??
      input.request.intent?.player?.key;
    const slot = input.request.slotMove?.toSlot ?? input.request.placement?.toSlot;
    if (player === undefined || slot === undefined) {
      return {
        status: "failed",
        detail: "This move names no player and destination place, so nothing was sent.",
      } satisfies TransactionPlanWriteResult;
    }
    return yield* reserveMoveOf({ ...input, player, slot, coverage });
  });
}

function reserveMoveOf(input: {
  readonly queries: QueryRepository["Service"];
  readonly context: TeamContext;
  readonly request: TransactionPlanWriteRequest;
  readonly player: string;
  readonly slot: string;
  readonly coverage: ProviderRosterCoverage;
}): Effect.Effect<TransactionPlanWriteResult> {
  return Effect.gen(function* () {
    const result = yield* writeResult(
      input.queries,
      input.context,
      input.context.provider.applyReserveMove({
        ...providerIdentity(input.context),
        providerTeamKey: input.context.owned.team.providerTeamKey,
        coverage: input.coverage,
        providerPlayerKey: input.player,
        slot: input.slot,
      }),
    );
    if (result.status !== "accepted") {
      return outcomeOf(result, "slot move");
    }
    return { status: "executed" } satisfies TransactionPlanWriteResult;
  });
}

function tradeOf(input: {
  readonly queries: QueryRepository["Service"];
  readonly context: TeamContext;
  readonly request: TransactionPlanWriteRequest;
  readonly league: ProviderLeagueSettings;
}): Effect.Effect<TransactionPlanWriteResult> {
  return Effect.gen(function* () {
    if (input.request.counterpartyKey === undefined) {
      return {
        status: "failed",
        detail: "This trade names no other team, so no offer was sent.",
      } satisfies TransactionPlanWriteResult;
    }
    const sent = yield* Effect.result(
      input.context.provider.proposeTrade({
        ...providerIdentity(input.context),
        providerLeagueKey: input.league.providerLeagueKey,
        providerTeamKey: input.context.owned.team.providerTeamKey,
        counterpartyTeamKey: input.request.counterpartyKey,
        send: input.request.drops,
        receive: input.request.adds,
        picks: input.request.picks.map((pick) => ({
          round: pick.round,
          sourceTeamKey: pick.sourceTeamKey,
          destinationTeamKey: pick.destinationTeamKey,
        })),
        note: undefined,
      }),
    );
    if (sent._tag === "Failure") {
      yield* recordRejection(input.queries, input.context, sent.failure);
      return {
        status: "retry",
        detail: "The offer did not reach your league. Try again on the next check.",
      } satisfies TransactionPlanWriteResult;
    }
    return tradeOutcome(sent.success);
  });
}

function tradeOutcome(result: ProviderTradeProposalResult): TransactionPlanWriteResult {
  switch (result.status) {
    case "accepted":
      return {
        status: "pending",
        detail: "Offer sent. The other manager decides.",
      };
    case "rejected":
      return { status: "failed", detail: result.detail ?? "Your league refused the offer." };
    case "not_sent":
      return {
        status: "retry",
        detail: "The offer did not reach your league. Try again on the next check.",
      };
    case "unknown":
      return {
        status: "unknown",
        detail:
          "Your league did not confirm the offer, so it was not retried. Check the trade page before proposing again.",
      };
  }
}

function writeResult(
  queries: QueryRepository["Service"],
  context: TeamContext,
  program: Effect.Effect<
    ProviderWriteResult,
    | import("#contexts/connections/Provider.ts").ProviderSessionRejected
    | import("#contexts/connections/Provider.ts").ProviderResponseInvalid
  >,
): Effect.Effect<ProviderWriteResult> {
  return Effect.gen(function* () {
    const result = yield* Effect.result(program);
    if (result._tag === "Success") {
      return result.success;
    }
    yield* recordRejection(queries, context, result.failure);
    return { status: "not_sent", reason: "request_failed" } as const;
  });
}

function outcomeOf(
  result: Extract<ProviderWriteResult, { readonly status: "rejected" | "not_sent" | "unknown" }>,
  operation: string,
): TransactionPlanWriteResult {
  switch (result.status) {
    case "rejected":
      return {
        status: "failed",
        detail: result.detail ?? `Your league refused the ${operation}.`,
      };
    case "not_sent":
      return {
        status: "retry",
        detail:
          result.reason === "session_incomplete"
            ? "Your league session was incomplete, so nothing was sent. Reconnect and try again."
            : "The request did not reach your league. Try again on the next check.",
      };
    case "unknown":
      return {
        status: "unknown",
        detail:
          "Your league did not confirm the outcome, so this move was not retried. Check your league's site before changing it.",
      };
  }
}

function recordRejection(
  queries: QueryRepository["Service"],
  context: TeamContext,
  failure:
    | import("#contexts/connections/Provider.ts").ProviderReadFailure
    | import("#contexts/connections/Provider.ts").ProviderSessionRejected
    | import("#contexts/connections/Provider.ts").ProviderResponseInvalid,
): Effect.Effect<void> {
  if (failure._tag !== "provider.session_rejected") {
    return Effect.void;
  }
  return queries
    .recordSessionRejected(context.userId, context.owned, sessionEvidenceOf(failure))
    .pipe(Effect.ignore);
}

function coverageOf(league: ProviderLeagueSettings): ProviderRosterCoverage | undefined {
  if (league.rosterCoverage === "week") {
    const week = league.periodWindow?.current;
    return week === undefined ? undefined : { type: "week", week };
  }
  const date = rosterChangeDate({
    rule: league.rosterChange?.rule,
    currentDate: league.currentDate,
  });
  return date === undefined ? undefined : { type: "date", date };
}
