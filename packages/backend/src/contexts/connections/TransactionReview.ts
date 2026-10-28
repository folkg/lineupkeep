import { Context } from "effect";
import type { Effect } from "effect";
import { Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";

import { ProviderKey } from "./Connection.ts";
import { TeamId } from "./FantasyTeam.ts";
import {
  CounterpartyRef,
  NarrowingResult as NarrowingResultSchema,
  PlayerRef,
  QueryBudget,
  QueryCoverage,
  QueryFailure,
  QueryPage,
  QueryStatus,
  QueryTeam,
} from "./QueryValues.ts";
import type { QueryError } from "./QueryValues.ts";

const ReviewIntentKind = Schema.Literals(["add", "add_drop", "drop", "trade"]);

export const ReviewIntent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("add"),
    add: PlayerRef,
  }),
  Schema.Struct({
    kind: Schema.Literal("add_drop"),
    add: PlayerRef,
    drop: PlayerRef,
  }),
  Schema.Struct({
    kind: Schema.Literal("drop"),
    drop: PlayerRef,
  }),
  Schema.Struct({
    kind: Schema.Literal("trade"),
    send: Schema.Array(PlayerRef).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(10))),
    receive: Schema.Array(PlayerRef).pipe(
      Schema.check(Schema.isMinLength(1), Schema.isMaxLength(10)),
    ),
    counterparty: CounterpartyRef,
  }),
]);
export type ReviewIntent = typeof ReviewIntent.Type;

export const TransactionReviewInput = Schema.Struct({
  team: TeamId,
  intents: Schema.Array(ReviewIntent).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(5)),
  ),
});
export type TransactionReviewInput = typeof TransactionReviewInput.Type;

export const ReviewLink = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("review_only"),
    index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    kind: ReviewIntentKind,
    url: Schema.String.pipe(
      Schema.check(
        Schema.isMinLength(1),
        Schema.isMaxLength(2_048),
        Schema.isPattern(/^https:\/\//u),
      ),
    ),
    players: Schema.Array(PlayerRef),
    counterparty: Schema.optional(CounterpartyRef),
    humanReview: Schema.String,
  }),
  Schema.Struct({
    status: Schema.Literal("unsupported"),
    index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    kind: ReviewIntentKind,
    players: Schema.Array(PlayerRef),
    counterparty: Schema.optional(CounterpartyRef),
    detail: Schema.String,
  }),
]);
export type ReviewLink = typeof ReviewLink.Type;

export const ReviewLinksData = Schema.Struct({
  status: QueryStatus,
  team: QueryTeam,
  linkTemplate: Schema.Struct({
    provider: ProviderKey,
    version: Schema.NonEmptyString,
  }),
  links: Schema.Array(ReviewLink),
  instruction: Schema.String,
  coverage: Schema.Array(QueryCoverage),
  failures: Schema.Array(QueryFailure),
  page: QueryPage,
  budget: QueryBudget,
});
export type ReviewLinksData = typeof ReviewLinksData.Type;
export const ReviewLinksResult = Schema.Union([ReviewLinksData, NarrowingResultSchema]);
export type ReviewLinksResult = typeof ReviewLinksResult.Type;

export class TransactionReviews extends Context.Service<
  TransactionReviews,
  TransactionReviewsShape
>()("@lineupkeep/backend/contexts/connections/TransactionReview/TransactionReviews") {}

export type TransactionReviewsShape = {
  readonly generate: (
    userId: UserId,
    input: TransactionReviewInput,
  ) => Effect.Effect<ReviewLinksResult, QueryError>;
};
