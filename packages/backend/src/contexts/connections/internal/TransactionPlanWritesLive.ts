import { Effect, Layer } from "effect";

import type {
  ProviderLeagueSettings,
  ProviderTradeProposalResult,
  ProviderWriteResult,
} from "#contexts/connections/Provider.ts";
import { sessionEvidenceOf } from "#contexts/connections/Provider.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";
import { rosterCoverageOf } from "#contexts/connections/RosterTiming.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import { loadTeamContext, providerIdentity } from "./QueryContext.ts";
import type { TeamContext } from "./QueryContext.ts";
import { QueryRepository } from "./QueryRepository.ts";
import type {
  TransactionPlanAction,
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
    const actions = plannedActions(input.request);
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
          actions: withOutcome(actions, "pending"),
        } satisfies TransactionPlanWriteResult;
      }
      return yield* reserveAfterAdd({ ...input, actions });
    }
    const outcome = outcomeOf(transaction, "transaction");
    return outcome.status === "retry"
      ? outcome
      : { ...outcome, actions: withOutcome(actions, outcome.status, outcome.detail) };
  });
}

function reserveAfterAdd(input: {
  readonly queries: QueryRepository["Service"];
  readonly context: TeamContext;
  readonly request: TransactionPlanWriteRequest;
  readonly league: ProviderLeagueSettings;
  readonly actions: ReadonlyArray<TransactionPlanAction>;
}): Effect.Effect<TransactionPlanWriteResult> {
  if (input.request.intent?.to !== "reserve") {
    return Effect.succeed({ status: "executed", actions: withOutcome(input.actions, "executed") });
  }
  const placement = input.request.placement;
  const player = placement?.playerKey ?? input.request.adds[0];
  const slot = placement?.toSlot;
  if (player === undefined || slot === undefined) {
    const detail = "The add reached your league, but no reserve place was named for it.";
    return Effect.succeed({
      status: "unknown",
      detail,
      actions: reserveActions({ actions: input.actions, outcome: "unknown", detail }),
    });
  }
  const coverage = rosterCoverageOf(input.league);
  if (coverage === undefined) {
    const detail =
      "The add reached your league, but the league publishes no current period to place the player in reserve.";
    return Effect.succeed({
      status: "unknown",
      detail,
      actions: reserveActions({ actions: input.actions, outcome: "unknown", detail }),
    });
  }
  return Effect.gen(function* () {
    const result = yield* writeResult(
      input.queries,
      input.context,
      input.context.provider.applyReserveMove({
        ...providerIdentity(input.context),
        providerTeamKey: input.context.owned.team.providerTeamKey,
        coverage,
        providerPlayerKey: player,
        slot,
      }),
    );
    if (result.status === "accepted") {
      return { status: "executed", actions: withOutcome(input.actions, "executed") } as const;
    }
    const outcome = outcomeOf(result, "slot move");
    return outcome.status === "retry"
      ? outcome
      : {
          ...outcome,
          actions: reserveActions({
            actions: input.actions,
            outcome: outcome.status,
            detail: outcome.detail,
          }),
        };
  });
}

function slotMoveOf(input: {
  readonly queries: QueryRepository["Service"];
  readonly context: TeamContext;
  readonly request: TransactionPlanWriteRequest;
  readonly league: ProviderLeagueSettings;
}): Effect.Effect<TransactionPlanWriteResult> {
  return Effect.gen(function* () {
    const coverage = rosterCoverageOf(input.league);
    if (coverage === undefined) {
      return {
        status: "failed",
        detail:
          "The league publishes no current date or scoring week, so the slot move could not be sent.",
        actions: [],
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
        actions: [],
      } satisfies TransactionPlanWriteResult;
    }
    const reserveFirst = destinationIsReserve(input.league, slot);
    let actions = slotActions(input.request, reserveFirst);
    const writeReserve = (): Effect.Effect<ProviderWriteResult> =>
      writeResult(
        input.queries,
        input.context,
        input.context.provider.applyReserveMove({
          ...providerIdentity(input.context),
          providerTeamKey: input.context.owned.team.providerTeamKey,
          coverage,
          providerPlayerKey: player,
          slot,
        }),
      );
    const writeDrop = (): Effect.Effect<ProviderWriteResult> =>
      writeResult(
        input.queries,
        input.context,
        input.context.provider.applyTransaction({
          ...providerIdentity(input.context),
          providerLeagueKey: input.league.providerLeagueKey,
          providerTeamKey: input.context.owned.team.providerTeamKey,
          adds: [],
          drops: input.request.drops,
          faabBid: undefined,
        }),
      );
    const decide = (
      result: Extract<
        ProviderWriteResult,
        { readonly status: "rejected" | "not_sent" | "unknown" }
      >,
      operation: string,
    ): DecidedWrite => {
      const outcome = outcomeOf(result, operation);
      return outcome.status === "retry"
        ? { status: "retry", detail: outcome.detail }
        : { status: outcome.status, detail: outcome.detail };
    };
    const partial = (
      outcome: DecidedWrite,
      landed: string,
      missing: string,
    ): TransactionPlanWriteResult => {
      if (outcome.status === "retry") {
        return {
          status: "failed",
          detail: `The ${landed} reached your league, but the ${missing} did not. Check your roster, then choose the move again or discard it.`,
          actions,
        };
      }
      return {
        status: outcome.status,
        detail: `The ${landed} reached your league. ${outcome.detail}`,
        actions,
      };
    };

    if (input.request.drops.length === 0) {
      const result = yield* writeReserve();
      if (result.status === "accepted") {
        return { status: "executed", actions: withOutcome(actions, "executed") } as const;
      }
      const outcome = outcomeOf(result, "slot move");
      return outcome.status === "retry"
        ? outcome
        : {
            ...outcome,
            actions: withKindOutcome(actions, "reserve_move", outcome.status, outcome.detail),
          };
    }

    if (reserveFirst) {
      const reserve = yield* writeReserve();
      if (reserve.status === "accepted") {
        actions = withKindOutcome(actions, "reserve_move", "executed");
        const drop = yield* writeDrop();
        if (drop.status === "accepted") {
          return { status: "executed", actions: withKindOutcome(actions, "drop", "executed") };
        }
        const outcome = decide(drop, "drop");
        actions = withKindOutcome(
          actions,
          "drop",
          outcome.status === "retry" ? "skipped" : outcome.status,
          outcome.detail,
        );
        return partial(outcome, "slot move", "drop");
      }
      const outcome = decide(reserve, "slot move");
      actions = withKindOutcome(
        actions,
        "reserve_move",
        outcome.status === "retry" ? "skipped" : outcome.status,
        outcome.detail,
      );
      actions = withKindOutcome(actions, "drop", "skipped", outcome.detail);
      if (outcome.status === "retry") {
        return { status: "retry", detail: outcome.detail };
      }
      return { status: outcome.status, detail: outcome.detail, actions };
    }

    const drop = yield* writeDrop();
    if (drop.status !== "accepted") {
      const outcome = decide(drop, "drop");
      actions = withKindOutcome(
        actions,
        "drop",
        outcome.status === "retry" ? "skipped" : outcome.status,
        outcome.detail,
      );
      actions = withKindOutcome(actions, "reserve_move", "skipped", outcome.detail);
      if (outcome.status === "retry") {
        return { status: "retry", detail: outcome.detail };
      }
      return { status: outcome.status, detail: outcome.detail, actions };
    }
    actions = withKindOutcome(actions, "drop", "executed");
    const reserve = yield* writeReserve();
    if (reserve.status === "accepted") {
      return { status: "executed", actions: withKindOutcome(actions, "reserve_move", "executed") };
    }
    const outcome = decide(reserve, "slot move");
    actions = withKindOutcome(
      actions,
      "reserve_move",
      outcome.status === "retry" ? "skipped" : outcome.status,
      outcome.detail,
    );
    return partial(outcome, "drop", "slot move");
  });
}

type DecidedWrite =
  | { readonly status: "failed"; readonly detail: string }
  | { readonly status: "unknown"; readonly detail: string }
  | { readonly status: "retry"; readonly detail: string };

function destinationIsReserve(league: ProviderLeagueSettings, slot: string): boolean {
  return league.rosterPositions.some(
    (position) => position.position === slot && position.kind === "reserve",
  );
}

function slotActions(
  request: TransactionPlanWriteRequest,
  reserveFirst: boolean,
): ReadonlyArray<TransactionPlanAction> {
  const drops: ReadonlyArray<TransactionPlanAction> = request.drops.map((playerKey) => ({
    kind: "drop",
    playerKey,
    outcome: "skipped",
  }));
  const playerKey = request.slotMove?.playerKey ?? request.placement?.playerKey;
  const toSlot = request.slotMove?.toSlot ?? request.placement?.toSlot;
  const reserve =
    playerKey === undefined
      ? []
      : [
          {
            kind: "reserve_move" as const,
            playerKey,
            ...(request.placement?.fromSlot === undefined
              ? {}
              : { fromSlot: request.placement.fromSlot }),
            ...(toSlot === undefined ? {} : { toSlot }),
            outcome: "skipped" as const,
          },
        ];
  return reserveFirst ? [...reserve, ...drops] : [...drops, ...reserve];
}

function withKindOutcome(
  actions: ReadonlyArray<TransactionPlanAction>,
  kind: TransactionPlanAction["kind"],
  outcome: TransactionPlanAction["outcome"],
  detail?: string,
): ReadonlyArray<TransactionPlanAction> {
  return actions.map((action) =>
    action.kind === kind
      ? { ...action, outcome, ...(detail === undefined ? {} : { detail }) }
      : action,
  );
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
        actions: [],
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
        actions: [],
      };
    case "rejected":
      return {
        status: "failed",
        detail: result.detail ?? "Your league refused the offer.",
        actions: [],
      };
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
        actions: [],
      };
  }
}

function plannedActions(
  request: TransactionPlanWriteRequest,
): ReadonlyArray<TransactionPlanAction> {
  if (request.kind === "trade") {
    return [];
  }
  const actions: Array<TransactionPlanAction> = [
    ...request.adds.map((playerKey): TransactionPlanAction => ({
      kind: "add",
      playerKey,
      outcome: "skipped",
    })),
    ...request.drops.map((playerKey): TransactionPlanAction => ({
      kind: "drop",
      playerKey,
      outcome: "skipped",
    })),
  ];
  if (request.intent?.to === "reserve" && request.placement !== undefined) {
    actions.push({
      kind: "reserve_move",
      playerKey: request.placement.playerKey,
      ...(request.placement.fromSlot === undefined ? {} : { fromSlot: request.placement.fromSlot }),
      toSlot: request.placement.toSlot,
      outcome: "skipped",
    });
  }
  return actions;
}

function withOutcome(
  actions: ReadonlyArray<TransactionPlanAction>,
  outcome: TransactionPlanAction["outcome"],
  detail?: string,
): ReadonlyArray<TransactionPlanAction> {
  return actions.map((action) => ({
    ...action,
    outcome,
    ...(detail === undefined ? {} : { detail }),
  }));
}

function reserveActions(input: {
  readonly actions: ReadonlyArray<TransactionPlanAction>;
  readonly outcome: "failed" | "unknown";
  readonly detail: string;
}): ReadonlyArray<TransactionPlanAction> {
  return input.actions.map((action) =>
    action.kind === "reserve_move"
      ? { ...action, outcome: input.outcome, detail: input.detail }
      : { ...action, outcome: "executed" },
  );
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
):
  | { readonly status: "failed"; readonly detail: string }
  | { readonly status: "unknown"; readonly detail: string }
  | { readonly status: "retry"; readonly detail: string } {
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
