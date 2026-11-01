import { TeamId } from "@lineupkeep/backend/connections/FantasyTeam";
import { TradeOfferRef } from "@lineupkeep/backend/connections/QueryValues";
import {
  ProposalItemId,
  ProposalSetId,
  TransactionProposals,
} from "@lineupkeep/backend/connections/TransactionProposals";
import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { Effect, Schema } from "effect";

import type {
  TransactionReviewData,
  WithdrawTradeData,
} from "#contracts/connections/transactionContract.ts";
import { runUseCase } from "#server/backendEntry.ts";
import {
  TransactionInputInvalid,
  mapTransactionReviewError,
  toTransactionReviewView,
} from "#server/connections/transactionPresentation.ts";

export const readTransactionReviewServerFn = createServerFn({ method: "POST" })
  .validator((raw: { readonly set: string }) =>
    Schema.decodeResult(Schema.Struct({ set: ProposalSetId }))(raw),
  )
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "transactions.review",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => TransactionInputInvalid.make({})),
          );
          const proposals = yield* TransactionProposals;
          const review = yield* proposals
            .revalidate(userId, input)
            .pipe(Effect.catchTag("proposal.set_expired", () => proposals.read(userId, input)));
          return { review: toTransactionReviewView(review) } satisfies TransactionReviewData;
        }),
      (error) =>
        error._tag === "TransactionInputInvalid"
          ? { type: "transactions.input_invalid", outcome: "rejected" }
          : mapTransactionReviewError(error),
    );
  });

export const submitTransactionReviewServerFn = createServerFn({ method: "POST" })
  .validator((raw: { readonly set: string; readonly include: ReadonlyArray<string> }) =>
    Schema.decodeResult(
      Schema.Struct({
        set: ProposalSetId,
        include: Schema.Array(Schema.String.pipe(Schema.check(Schema.isUUID()))),
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
          const proposals = yield* TransactionProposals;
          const review = yield* proposals.submit(userId, {
            set: input.set,
            include: input.include.map((id) => Schema.decodeSync(ProposalItemId)(id)),
          });
          return { review: toTransactionReviewView(review) } satisfies TransactionReviewData;
        }),
      (error) =>
        error._tag === "TransactionInputInvalid"
          ? { type: "transactions.input_invalid", outcome: "rejected" }
          : mapTransactionReviewError(error),
    );
  });

export const withdrawTradeServerFn = createServerFn({ method: "POST" })
  .validator((raw: { readonly team: string; readonly item?: string; readonly offer?: string }) =>
    Schema.decodeResult(
      Schema.Struct({
        team: TeamId,
        item: Schema.optional(Schema.String.pipe(Schema.check(Schema.isUUID()))),
        offer: Schema.optional(Schema.String),
      }),
    )(raw),
  )
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "transactions.withdraw",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => TransactionInputInvalid.make({})),
          );
          const proposals = yield* TransactionProposals;
          const item =
            input.item === undefined
              ? undefined
              : yield* Schema.decodeEffect(ProposalItemId)(input.item).pipe(
                  Effect.mapError(() => TransactionInputInvalid.make({})),
                );
          const offer =
            input.offer === undefined
              ? undefined
              : yield* Schema.decodeEffect(TradeOfferRef)(input.offer).pipe(
                  Effect.mapError(() => TransactionInputInvalid.make({})),
                );
          const result = yield* proposals.withdrawTrade(userId, {
            team: input.team,
            ...(item === undefined ? {} : { item }),
            ...(offer === undefined ? {} : { offer }),
          });
          return {
            status: result.status,
            detail: result.detail,
          } satisfies WithdrawTradeData;
        }),
      (error) =>
        error._tag === "TransactionInputInvalid"
          ? { type: "transactions.input_invalid", outcome: "rejected" }
          : mapTransactionReviewError(error),
    );
  });
