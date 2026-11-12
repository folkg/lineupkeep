import { TeamId } from "@lineupkeep/backend/connections/FantasyTeam";
import { TradeOfferRef } from "@lineupkeep/backend/connections/QueryValues";
import {
  DismissProposalItemsInput,
  ListProposalSetsInput,
  ProposalItemId,
  ProposalSetId,
  TransactionProposals,
} from "@lineupkeep/backend/connections/TransactionProposals";
import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { Effect, Schema } from "effect";

import type {
  DismissTransactionProposalData,
  TransactionProposalListData,
  TransactionReviewData,
  WithdrawTradeData,
} from "#contracts/connections/transactionContract.ts";
import { runUseCase } from "#server/backendEntry.ts";
import {
  TransactionInputInvalid,
  mapTransactionReviewError,
  toTransactionProposalListView,
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
          const review = yield* proposals.revalidate(userId, input);
          return { review: toTransactionReviewView(review) } satisfies TransactionReviewData;
        }),
      (error) =>
        error._tag === "TransactionInputInvalid"
          ? { type: "transactions.input_invalid", outcome: "rejected" }
          : mapTransactionReviewError(error),
    );
  });

export const submitTransactionReviewServerFn = createServerFn({ method: "POST" })
  .validator(
    (raw: {
      readonly set: string;
      readonly include: ReadonlyArray<string>;
      readonly bids?: ReadonlyArray<{ readonly item: string; readonly bid: number }>;
    }) =>
      Schema.decodeResult(
        Schema.Struct({
          set: ProposalSetId,
          include: Schema.Array(ProposalItemId),
          bids: Schema.optional(
            Schema.Array(
              Schema.Struct({
                item: ProposalItemId,
                bid: Schema.Finite,
              }),
            ),
          ),
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
          const submission = yield* proposals.submit(userId, {
            set: input.set,
            include: input.include,
            bids: input.bids ?? [],
          });
          return {
            review: toTransactionReviewView(submission),
            submittedBids: submission.submittedBids,
          } satisfies TransactionReviewData;
        }),
      (error) =>
        error._tag === "TransactionInputInvalid"
          ? { type: "transactions.input_invalid", outcome: "rejected" }
          : mapTransactionReviewError(error),
    );
  });

export const listTransactionProposalSetsServerFn = createServerFn({ method: "POST" })
  .validator(
    (raw: {
      readonly team: string;
      readonly state?: "open" | "closed";
      readonly cursor?: string;
      readonly limit?: number;
    }) => Schema.decodeResult(ListProposalSetsInput)(raw),
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
          const proposals = yield* TransactionProposals;
          const list = yield* proposals.list(userId, input);
          return toTransactionProposalListView(list) satisfies TransactionProposalListData;
        }),
      (error) =>
        error._tag === "TransactionInputInvalid"
          ? { type: "transactions.input_invalid", outcome: "rejected" }
          : mapTransactionReviewError(error),
    );
  });

export const dismissTransactionProposalItemsServerFn = createServerFn({ method: "POST" })
  .validator(
    (raw: {
      readonly set: string;
      readonly items: ReadonlyArray<string>;
      readonly reason?: string;
    }) => Schema.decodeResult(DismissProposalItemsInput)(raw),
  )
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "transactions.dismiss",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => TransactionInputInvalid.make({})),
          );
          const proposals = yield* TransactionProposals;
          const outcome = yield* Effect.result(proposals.dismissItems(userId, input));
          if (outcome._tag === "Failure") {
            if (outcome.failure._tag === "proposal.items_not_open") {
              return {
                outcome: "refused",
                detail: outcome.failure.detail,
                refusals: outcome.failure.items.map((entry) => ({
                  item: entry.item,
                  detail: entry.detail,
                })),
              } satisfies DismissTransactionProposalData;
            }
            return yield* outcome.failure;
          }
          return {
            outcome: "dismissed",
            review: toTransactionReviewView(outcome.success),
          } satisfies DismissTransactionProposalData;
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
        item: Schema.optional(ProposalItemId),
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
          const offer =
            input.offer === undefined
              ? undefined
              : yield* Schema.decodeEffect(TradeOfferRef)(input.offer).pipe(
                  Effect.mapError(() => TransactionInputInvalid.make({})),
                );
          const result = yield* proposals.withdrawTrade(userId, {
            team: input.team,
            ...(input.item === undefined ? {} : { item: input.item }),
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
