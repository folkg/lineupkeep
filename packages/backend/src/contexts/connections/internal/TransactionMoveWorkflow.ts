import { Effect, Schema } from "effect";

import {
  TransactionDecisionActor,
  TransactionMoveKind,
  TransactionMovePhase,
  TransactionMoveResult,
  transactionMoveStatus,
} from "#contexts/connections/TransactionPlans.ts";
import { defineMachine, final, plan } from "#utilities/machine.ts";

import type { TransactionMoveRowRecord } from "./TransactionPlanRecord.ts";

export const TransactionMoveState = Schema.TaggedUnion({
  open_undecided: {},
  open_saved: {},
  open_now: {},
  open_confirmed: {},
  discarded: {},
  ran_immediately: {},
  ran_on_schedule: {},
  claim_waiting: {},
  claim_won: {},
  claim_lost: {},
  claim_lost_fallback_ran: {},
  claim_lost_retrying: {},
  all_choices_failed: {},
  fallback_unknown: {},
  offer_sent: {},
  failed: {},
  skipped: {},
  unknown: {},
});
export type TransactionMoveState = typeof TransactionMoveState.Type;

const TransactionMoveStates = {
  open_undecided: TransactionMoveState.cases.open_undecided,
  open_saved: TransactionMoveState.cases.open_saved,
  open_now: TransactionMoveState.cases.open_now,
  open_confirmed: TransactionMoveState.cases.open_confirmed,
  discarded: final(TransactionMoveState.cases.discarded),
  ran_immediately: final(TransactionMoveState.cases.ran_immediately),
  ran_on_schedule: final(TransactionMoveState.cases.ran_on_schedule),
  claim_waiting: TransactionMoveState.cases.claim_waiting,
  claim_won: final(TransactionMoveState.cases.claim_won),
  claim_lost: final(TransactionMoveState.cases.claim_lost),
  claim_lost_fallback_ran: final(TransactionMoveState.cases.claim_lost_fallback_ran),
  claim_lost_retrying: TransactionMoveState.cases.claim_lost_retrying,
  all_choices_failed: final(TransactionMoveState.cases.all_choices_failed),
  fallback_unknown: final(TransactionMoveState.cases.fallback_unknown),
  offer_sent: final(TransactionMoveState.cases.offer_sent),
  failed: TransactionMoveState.cases.failed,
  skipped: TransactionMoveState.cases.skipped,
  unknown: TransactionMoveState.cases.unknown,
};

export const TransactionMoveEvent = Schema.TaggedUnion({
  Save: {},
  Undecide: {},
  ConfirmNow: {},
  ConfirmLater: {},
  Discard: {},
  Write: {
    result: TransactionMoveResult,
    kind: TransactionMoveKind,
    bySystem: Schema.Boolean,
  },
  ClaimWon: {},
  ClaimLost: {
    result: Schema.Literals(["executed", "pending", "failed", "unknown"]),
    attemptedFallback: Schema.Boolean,
  },
  FallbackOutcome: {
    result: Schema.Literals(["executed", "pending", "failed", "unknown"]),
  },
});
export type TransactionMoveEvent = typeof TransactionMoveEvent.Type;

export type TransactionMoveRequest = TransactionMoveEvent;

type MoveTransition = {
  readonly target: TransactionMoveState["_tag"];
  guard?(args: {
    readonly state: TransactionMoveState;
    readonly event: TransactionMoveEvent;
  }): boolean;
  data(): Record<string, never>;
};

const writeOn = {
  Write: [
    {
      target: "ran_on_schedule",
      guard: ({ event }) => event._tag === "Write" && event.bySystem && event.result === "executed",
      data: () => ({}),
    },
    {
      target: "ran_immediately",
      guard: ({ event }) =>
        event._tag === "Write" && !event.bySystem && event.result === "executed",
      data: () => ({}),
    },
    {
      target: "claim_waiting",
      guard: ({ event }) =>
        event._tag === "Write" && event.result === "pending" && event.kind === "waiver_claim",
      data: () => ({}),
    },
    {
      target: "offer_sent",
      guard: ({ event }) =>
        event._tag === "Write" && event.result === "pending" && event.kind === "trade",
      data: () => ({}),
    },
    {
      target: "failed",
      guard: ({ event }) => event._tag === "Write" && event.result === "failed",
      data: () => ({}),
    },
    {
      target: "skipped",
      guard: ({ event }) => event._tag === "Write" && event.result === "skipped",
      data: () => ({}),
    },
    {
      target: "unknown",
      guard: ({ event }) => event._tag === "Write" && event.result === "unknown",
      data: () => ({}),
    },
  ],
} satisfies { readonly Write: ReadonlyArray<MoveTransition> };

const claimLostOn = {
  ClaimLost: [
    {
      target: "claim_lost_fallback_ran",
      guard: ({ event }) => event._tag === "ClaimLost" && event.result === "executed",
      data: () => ({}),
    },
    {
      target: "claim_lost_retrying",
      guard: ({ event }) => event._tag === "ClaimLost" && event.result === "pending",
      data: () => ({}),
    },
    {
      target: "all_choices_failed",
      guard: ({ event }) =>
        event._tag === "ClaimLost" && event.result === "failed" && event.attemptedFallback,
      data: () => ({}),
    },
    {
      target: "claim_lost",
      guard: ({ event }) =>
        event._tag === "ClaimLost" && event.result === "failed" && !event.attemptedFallback,
      data: () => ({}),
    },
    {
      target: "fallback_unknown",
      guard: ({ event }) => event._tag === "ClaimLost" && event.result === "unknown",
      data: () => ({}),
    },
  ],
} satisfies { readonly ClaimLost: ReadonlyArray<MoveTransition> };

const fallbackOutcomeOn = {
  FallbackOutcome: [
    {
      target: "claim_lost_fallback_ran",
      guard: ({ event }) => event._tag === "FallbackOutcome" && event.result === "executed",
      data: () => ({}),
    },
    {
      target: "claim_lost_retrying",
      guard: ({ event }) => event._tag === "FallbackOutcome" && event.result === "pending",
      data: () => ({}),
    },
    {
      target: "all_choices_failed",
      guard: ({ event }) => event._tag === "FallbackOutcome" && event.result === "failed",
      data: () => ({}),
    },
    {
      target: "fallback_unknown",
      guard: ({ event }) => event._tag === "FallbackOutcome" && event.result === "unknown",
      data: () => ({}),
    },
  ],
} satisfies { readonly FallbackOutcome: ReadonlyArray<MoveTransition> };

const decisionOn = {
  Save: { target: "open_saved", data: () => ({}) },
  Undecide: { target: "open_undecided", data: () => ({}) },
  ConfirmNow: { target: "open_now", data: () => ({}) },
  ConfirmLater: { target: "open_confirmed", data: () => ({}) },
  Discard: { target: "discarded", data: () => ({}) },
} satisfies {
  readonly Save: MoveTransition;
  readonly Undecide: MoveTransition;
  readonly ConfirmNow: MoveTransition;
  readonly ConfirmLater: MoveTransition;
  readonly Discard: MoveTransition;
};

const retryOn = {
  Write: writeOn.Write,
  Discard: { target: "discarded", data: () => ({}) },
} satisfies {
  readonly Write: ReadonlyArray<MoveTransition>;
  readonly Discard: MoveTransition;
};

export const TransactionMoveWorkflow = defineMachine<TransactionMoveState, TransactionMoveRequest>({
  root: TransactionMoveStates,
  events: TransactionMoveEvent,
  initial: {
    target: "open_undecided",
    data: ({ input }) => input,
  },
  states: {
    open_undecided: { on: { ...decisionOn, ...writeOn } },
    open_saved: { on: { ...decisionOn, ...writeOn } },
    open_now: { on: { ...decisionOn, ...writeOn } },
    open_confirmed: { on: { ...decisionOn, ...writeOn } },
    discarded: {},
    ran_immediately: {},
    ran_on_schedule: {},
    claim_waiting: {
      on: {
        ClaimWon: { target: "claim_won", data: () => ({}) },
        ...claimLostOn,
      },
    },
    claim_won: {},
    claim_lost: {},
    claim_lost_fallback_ran: {},
    claim_lost_retrying: { on: { ...fallbackOutcomeOn } },
    all_choices_failed: {},
    fallback_unknown: {},
    offer_sent: {},
    failed: { on: { ...retryOn } },
    skipped: { on: { ...retryOn } },
    unknown: { on: { ...retryOn } },
  },
});

export function verifySettlement(input: {
  readonly move: TransactionMoveRowRecord;
  readonly settlement: TransactionMoveSettlementFacts;
}): Effect.Effect<void> {
  return Effect.gen(function* () {
    const current = transactionMoveStatus(input.move);
    const event = settlementEvent(current, input.move.kind, input.settlement);
    if (event === undefined) {
      return yield* Effect.die(new Error(`A ${current} move cannot accept a settlement`));
    }
    const nextFacts = {
      ...input.move,
      result: input.settlement.result,
      phase: input.settlement.phase ?? input.move.phase,
      attempts: input.settlement.attempts,
      runDecidedBy: input.settlement.run?.decidedBy ?? input.move.runDecidedBy,
    };
    const expected = transactionMoveStatus(nextFacts);
    const next = yield* plan(TransactionMoveWorkflow, { state: { _tag: current } }, event).pipe(
      Effect.orDie,
    );
    if (next._tag !== expected) {
      return yield* Effect.die(
        new Error(`A ${current} move settled as ${expected}, but the machine reached ${next._tag}`),
      );
    }
  });
}

export type TransactionMoveSettlementFacts = {
  readonly result: TransactionMoveResult;
  readonly phase?: TransactionMovePhase;
  readonly attempts: ReadonlyArray<{ readonly kind: "claim" | "fallback" }>;
  readonly run?: { readonly decidedBy?: TransactionDecisionActor };
};

function settlementEvent(
  status: TransactionMoveState["_tag"],
  kind: TransactionMoveKind,
  settlement: TransactionMoveSettlementFacts,
): TransactionMoveEvent | undefined {
  switch (status) {
    case "open_undecided":
    case "open_saved":
    case "open_now":
    case "open_confirmed":
    case "failed":
    case "skipped":
    case "unknown":
      return {
        _tag: "Write",
        result: settlement.result,
        kind,
        bySystem: settlement.run?.decidedBy === "system",
      };
    case "claim_waiting":
      if (settlement.phase === "won") {
        return { _tag: "ClaimWon" };
      }
      if (settlement.phase === "lost") {
        return {
          _tag: "ClaimLost",
          result: claimLostResult(settlement.result),
          attemptedFallback: settlement.attempts.some((attempt) => attempt.kind === "fallback"),
        };
      }
      return undefined;
    case "claim_lost_retrying":
      return { _tag: "FallbackOutcome", result: fallbackResult(settlement.result) };
    case "discarded":
    case "ran_immediately":
    case "ran_on_schedule":
    case "claim_won":
    case "claim_lost":
    case "claim_lost_fallback_ran":
    case "all_choices_failed":
    case "fallback_unknown":
    case "offer_sent":
      return undefined;
  }
}

function claimLostResult(
  result: TransactionMoveResult,
): "executed" | "pending" | "failed" | "unknown" {
  switch (result) {
    case "executed":
    case "pending":
    case "failed":
    case "unknown":
      return result;
    case "skipped":
      throw new Error("A lost claim cannot settle as skipped");
  }
}

function fallbackResult(
  result: TransactionMoveResult,
): "executed" | "pending" | "failed" | "unknown" {
  switch (result) {
    case "executed":
    case "pending":
    case "failed":
    case "unknown":
      return result;
    case "skipped":
      throw new Error("A fallback cannot settle as skipped");
  }
}
