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
      "Report a bug, a data problem, friction, or a wishlist item for the account you act for. Include what you were doing, what happened, and what you expected; put the tool name, team reference, client name, and app surface in context when they help. `list_feedback` reads the report back with its status under the same scope, so the report is never a channel you can write to but not follow. This needs only fantasy:read, the scope every client holds, so a client that lacks a write scope can still report a problem and follow it. Never include passwords, sign-in cookies, account identifiers, or raw responses from the league's site: reports are stored as plain text and read back verbatim. Returns the report id and its status (open) so you can cite it later.",
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
      "List the feedback reports owned by the account you act for, newest first, with each report's current status so a submitter can see what happened to what they filed. Filter by status, kind, or start time and bound the page with limit (1-50, default 20). Each returned record includes the full title and body, so narrow the filters rather than expecting an unbounded page. This needs only fantasy:read, the same scope as submission. Another person's reports are never visible, and a report id from another account is reported as not found.",
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
