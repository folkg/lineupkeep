import type { UserId } from "@lineupkeep/backend/auth/User";
import { fantasyQueryScopes } from "@lineupkeep/backend/connections/QueryScopes";
import type { QueryError } from "@lineupkeep/backend/connections/QueryValues";
import {
  ReviewLinksResult,
  TransactionReviewInput,
  TransactionReviews,
} from "@lineupkeep/backend/connections/TransactionReview";
import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import { Tool, Toolkit } from "effect/ai";

import { RequiredScope } from "./toolAuthorization";

const ToolFailure = Schema.Struct({ code: Schema.String, message: Schema.String });

export const transactionTools = Toolkit.make(
  Tool.make("generate_transaction_review_links", {
    description:
      "Generate human-review-only provider links for proposed add, add/drop, drop, or trade intents. Links open the provider's review page in a browser; this tool never submits a transaction, never returns submission-stage URLs, and never guarantees that the provider will accept a proposal. Each result reports the `linkTemplate` version so a client can detect a stale template. The result also carries `ownerNote`, the linked team's note from Lineupgrade: it is owner context, not a provider or league fact, and can explain keepers, dynasty cost, salary, or why a player is held before a person reviews the proposal. An intent the provider cannot prefill returns an unsupported result with the reason instead of a link that opens an empty form; the provider publishes no parameterized trade proposal page, so every `trade` intent is unsupported. This scope creates prefill links only: it cannot list, read, or act on trade offers, because the provider publishes no proposals resource.",
    parameters: TransactionReviewInput,
    success: Schema.toCodecJson(ReviewLinksResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.reviewTransactions)
    .annotate(Tool.Title, "Generate transaction review links")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
);

export function transactionToolHandlers(
  userId: UserId,
): Layer.Layer<
  Tool.HandlersFor<Toolkit.Tools<typeof transactionTools>>,
  never,
  TransactionReviews
> {
  return transactionTools.toLayer(
    Effect.gen(function* () {
      const reviews = yield* TransactionReviews;
      return transactionTools.of({
        generate_transaction_review_links: (input) =>
          reviews.generate(userId, input).pipe(mapOutcome),
      });
    }),
  );
}

function mapOutcome<A>(
  program: Effect.Effect<A, QueryError>,
): Effect.Effect<A, { code: string; message: string }, never> {
  return program.pipe(
    Effect.catch((error) => {
      switch (error._tag) {
        case "query.team_not_found":
          return reject(
            "team_not_found",
            "The selected team is not available to this account. List your teams again.",
          );
        case "query.connection_not_ready":
          return reject(
            "connection_not_ready",
            "The selected team's connection is not ready. Reconnect it and list your teams again.",
          );
        case "query.cursor_invalid":
          return reject("cursor_invalid", reviewCursorMessage(error.reason));
        case "query.reference_invalid":
          return reject(
            "reference_invalid",
            "A private reference in this request is invalid for this account. Start the review again.",
          );
        case "query.selection_invalid":
          return reject(
            "selection_invalid",
            "The requested team, player, or period is outside what this league establishes.",
          );
        case "query.persistence_failed":
          return Effect.annotateCurrentSpan({
            "app.outcome": "failure",
            "error.type": error._tag,
          }).pipe(
            Effect.andThen(
              Effect.die(
                new Error("The review links could not be generated. Start the review again."),
              ),
            ),
          );
      }
    }),
  );
}

function reviewCursorMessage(reason: "invalid" | "expired" | "mismatch"): string {
  switch (reason) {
    case "mismatch":
      return "The continuation cursor was issued for a different request. A cursor is bound to the arguments of the call that returned it, so a cursor from one intent selection is refused for another. Repeat the first call with the arguments you want and follow the `page.next` it returns.";
    case "expired":
      return "The continuation cursor has expired, because a cursor is valid for 15 minutes. Repeat the first call to start a new page sequence.";
    case "invalid":
      return "The continuation cursor is not one this server issued. Copy `page.next` from the previous response and try again.";
  }
}

function reject(
  code: string,
  message: string,
): Effect.Effect<never, { code: string; message: string }, never> {
  return Effect.annotateCurrentSpan({ "app.outcome": "rejected", "error.type": code }).pipe(
    Effect.andThen(Effect.fail({ code, message })),
  );
}
