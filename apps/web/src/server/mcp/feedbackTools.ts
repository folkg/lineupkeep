import type { AuthenticatedAgent } from "@lineupkeep/backend/auth/Auth";
import { fantasyQueryScopes } from "@lineupkeep/backend/connections/QueryScopes";
import {
  Feedback,
  FeedbackContentInvalid,
  FeedbackFilter,
  FeedbackRateLimited,
  FeedbackReport,
  FeedbackSubmission,
} from "@lineupkeep/backend/feedback/Feedback";
import type { FeedbackPersistenceFailed } from "@lineupkeep/backend/feedback/Feedback";
import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import { Tool, Toolkit } from "effect/ai";

import { RequiredScope } from "./toolAuthorization";

const ToolFailure = Schema.Struct({ code: Schema.String, message: Schema.String });

const SubmitFeedbackResult = Schema.Struct({
  feedback: FeedbackReport,
  detail: Schema.NonEmptyString,
});
type SubmitFeedbackResult = typeof SubmitFeedbackResult.Type;

const ListFeedbackInput = Schema.Struct({
  statuses: FeedbackFilter.fields.statuses,
  kinds: FeedbackFilter.fields.kinds,
  since: FeedbackFilter.fields.since,
  limit: FeedbackFilter.fields.limit,
});

const ListFeedbackResult = Schema.Struct({
  feedback: Schema.Array(FeedbackReport),
  page: Schema.Struct({ returned: Schema.Int, limit: Schema.Int }),
});
type ListFeedbackResult = typeof ListFeedbackResult.Type;

export const feedbackTools = Toolkit.make(
  Tool.make("submit_feedback", {
    description:
      "File a bug, data problem, friction, or wishlist item for this account; returns the report id and status. Never include passwords, cookies, account identifiers, or raw league-site responses: reports are stored as plain text.",
    parameters: FeedbackSubmission,
    success: Schema.toCodecJson(SubmitFeedbackResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "Submit feedback")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, false)
    .annotate(Tool.OpenWorld, false),
  Tool.make("list_feedback", {
    description:
      "Your account's feedback reports, newest first, with status. Each record carries its full title and body.",
    parameters: ListFeedbackInput,
    success: Schema.toCodecJson(ListFeedbackResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "List feedback")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
);

export function feedbackToolHandlers(
  agent: AuthenticatedAgent,
): Layer.Layer<Tool.HandlersFor<Toolkit.Tools<typeof feedbackTools>>, never, Feedback> {
  return feedbackTools.toLayer(
    Effect.gen(function* () {
      const feedback = yield* Feedback;
      const submitter = { kind: "agent", reference: "mcp" } as const;
      return feedbackTools.of({
        submit_feedback: (submission) =>
          feedback.submit(agent.userId, submitter, [submission]).pipe(
            Effect.map((reports): SubmitFeedbackResult => {
              const [report] = reports;
              if (report === undefined) {
                throw new Error("A submitted feedback report was not returned");
              }
              return {
                feedback: report,
                detail: `Recorded as ${report.id} with status ${report.status}.`,
              };
            }),
            mapFailure,
          ),
        list_feedback: (filter) =>
          feedback.list(agent.userId, { ...filter, limit: filter.limit ?? 20 }).pipe(
            Effect.map((reports): ListFeedbackResult => ({
              feedback: reports,
              page: { returned: reports.length, limit: filter.limit ?? 20 },
            })),
            mapFailure,
          ),
      });
    }),
  );
}

function mapFailure<A>(
  program: Effect.Effect<
    A,
    FeedbackContentInvalid | FeedbackRateLimited | FeedbackPersistenceFailed
  >,
): Effect.Effect<A, { code: string; message: string }, never> {
  return program.pipe(
    Effect.catchTags({
      "feedback.content_invalid": (error) =>
        Effect.annotateCurrentSpan({
          "app.outcome": "rejected",
          "error.type": error._tag,
        }).pipe(Effect.andThen(Effect.fail({ code: "content_invalid", message: error.detail }))),
      "feedback.rate_limited": (error) =>
        Effect.annotateCurrentSpan({
          "app.outcome": "rejected",
          "error.type": error._tag,
        }).pipe(
          Effect.andThen(
            Effect.fail({
              code: "rate_limited",
              message: `Too many reports in this hour. Try again in ${error.retryAfterSeconds} seconds.`,
            }),
          ),
        ),
      "feedback.persistence_failed": (error) =>
        Effect.annotateCurrentSpan({
          "app.outcome": "failure",
          "error.type": error._tag,
        }).pipe(
          Effect.andThen(
            Effect.die(new Error("Feedback could not be recorded or read. Try again.")),
          ),
        ),
    }),
  );
}
