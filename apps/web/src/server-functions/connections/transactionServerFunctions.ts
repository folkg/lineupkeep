import { TeamId } from "@lineupkeep/backend/connections/FantasyTeam";
import {
  DiscardTransactionMoveInput,
  ListTransactionMovesInput,
  SaveTransactionMoveInput,
  TransactionMoveCursor,
  TransactionMoveId,
  TransactionMovePageLimit,
  TransactionPlanInput,
  TransactionPlanService,
} from "@lineupkeep/backend/connections/TransactionPlans";
import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { Effect, Schema } from "effect";

import type {
  TransactionMoveListData,
  TransactionPlanData,
  TransactionSubmitTodayData,
} from "#contracts/connections/transactionContract.ts";
import { runUseCase } from "#server/backendEntry.ts";
import {
  TransactionInputInvalid,
  actionOf,
  mapTransactionError,
  toTransactionMoveListView,
  toTransactionPlanData,
} from "#server/connections/transactionPresentation.ts";

export const listTransactionMovesServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof ListTransactionMovesInput.Encoded) =>
    Schema.decodeResult(ListTransactionMovesInput)(raw),
  )
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "transactions.list",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => TransactionInputInvalid.make({})),
          );
          const plans = yield* TransactionPlanService;
          const list = yield* plans.list(userId, input);
          return toTransactionMoveListView(list) satisfies TransactionMoveListData;
        }),
      (error) =>
        error._tag === "TransactionInputInvalid"
          ? { type: "transactions.input_invalid", outcome: "rejected" }
          : mapTransactionError(error),
    );
  });

export const readTransactionTimelineServerFn = createServerFn({ method: "POST" })
  .validator(
    (raw: {
      readonly after?: typeof TransactionMoveCursor.Encoded;
      readonly limit?: typeof TransactionMovePageLimit.Encoded;
    }) =>
      Schema.decodeResult(
        Schema.Struct({
          after: Schema.optional(TransactionMoveCursor),
          limit: Schema.optional(TransactionMovePageLimit),
        }),
      )(raw),
  )
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "transactions.timeline",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => TransactionInputInvalid.make({})),
          );
          const plans = yield* TransactionPlanService;
          const list = yield* plans.timeline(userId, input);
          return toTransactionMoveListView(list) satisfies TransactionMoveListData;
        }),
      (error) =>
        error._tag === "TransactionInputInvalid"
          ? { type: "transactions.input_invalid", outcome: "rejected" }
          : mapTransactionError(error),
    );
  });

export const readTransactionPlanServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof TransactionPlanInput.Encoded) =>
    Schema.decodeResult(TransactionPlanInput)(raw),
  )
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "transactions.plan",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => TransactionInputInvalid.make({})),
          );
          const plans = yield* TransactionPlanService;
          const plan = yield* plans.plan(userId, input);
          return toTransactionPlanData(plan) satisfies TransactionPlanData;
        }),
      (error) =>
        error._tag === "TransactionInputInvalid"
          ? { type: "transactions.input_invalid", outcome: "rejected" }
          : mapTransactionError(error),
    );
  });

export const saveTransactionMoveServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof SaveTransactionMoveInput.Encoded) =>
    Schema.decodeResult(SaveTransactionMoveInput)(raw),
  )
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "transactions.save",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => TransactionInputInvalid.make({})),
          );
          const plans = yield* TransactionPlanService;
          const result = yield* plans.save(userId, input);
          return actionOf(input.move, "saved", result.refused);
        }),
      (error) =>
        error._tag === "TransactionInputInvalid"
          ? { type: "transactions.input_invalid", outcome: "rejected" }
          : mapTransactionError(error),
    );
  });

export const discardTransactionMoveServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof DiscardTransactionMoveInput.Encoded) =>
    Schema.decodeResult(DiscardTransactionMoveInput)(raw),
  )
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "transactions.discard",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => TransactionInputInvalid.make({})),
          );
          const plans = yield* TransactionPlanService;
          const result = yield* plans.discard(userId, input);
          return actionOf(input.move, "discarded", result.refused);
        }),
      (error) =>
        error._tag === "TransactionInputInvalid"
          ? { type: "transactions.input_invalid", outcome: "rejected" }
          : mapTransactionError(error),
    );
  });

export const submitTransactionTodayServerFn = createServerFn({ method: "POST" })
  .validator(
    (raw: {
      readonly choices: ReadonlyArray<{
        readonly team: string;
        readonly move: string;
        readonly choice: "now" | "discard";
      }>;
    }) =>
      Schema.decodeResult(
        Schema.Struct({
          choices: Schema.Array(
            Schema.Struct({
              team: TeamId,
              move: TransactionMoveId,
              choice: Schema.Literals(["now", "discard"]),
            }),
          ).pipe(Schema.check(Schema.isMinLength(1))),
        }),
      )(raw),
  )
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "transactions.submit",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => TransactionInputInvalid.make({})),
          );
          const plans = yield* TransactionPlanService;
          return (yield* plans.submitToday(userId, input)) satisfies TransactionSubmitTodayData;
        }),
      (error) =>
        error._tag === "TransactionInputInvalid"
          ? { type: "transactions.input_invalid", outcome: "rejected" }
          : mapTransactionError(error),
    );
  });
