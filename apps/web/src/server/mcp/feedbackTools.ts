import type { UserId } from "@lineupkeep/backend/auth/User";
import { connectionScopes } from "@lineupkeep/backend/connections/ConnectionScopes";
import {
  Feedback,
  FeedbackContentInvalid,
  FeedbackFilter,
  FeedbackRateLimited,
  FeedbackReport,
  FeedbackSubmission,
  FeedbackTriageInput,
  FeedbackTriageResult,
} from "@lineupkeep/backend/feedback/Feedback";
import type { FeedbackPersistenceFailed } from "@lineupkeep/backend/feedback/Feedback";
import { feedbackScopes } from "@lineupkeep/backend/feedback/FeedbackScopes";
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

export const TriageFeedbackInput = Schema.Struct({
  feedback: Schema.Array(FeedbackTriageInput).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(10)),
  ),
});
export type TriageFeedbackInput = typeof TriageFeedbackInput.Type;

const TriageFeedbackResult = Schema.Struct({
  results: Schema.Array(FeedbackTriageResult),
});
type TriageFeedbackResult = typeof TriageFeedbackResult.Type;

export const feedbackTools = Toolkit.make(
  Tool.make("submit_feedback", {
    description:
      "Report a bug, a data problem, friction, or a wishlist item for the account you act for. Include what you were doing, what happened, and what you expected; put the tool name, team reference, client name, and app surface in context when they help. The account can then list the report, acknowledge it, and close it with a note. This needs only connections:read, so a client that cannot hold feedback:manage can still report a problem. Never include passwords, provider cookies, account identifiers, or raw provider payloads: reports are stored as plain text and read back verbatim. Returns the report id and its status (open) so you can cite it later.",
    parameters: FeedbackSubmission,
    success: Schema.toCodecJson(SubmitFeedbackResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, connectionScopes.read)
    .annotate(Tool.Title, "Submit feedback")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, false)
    .annotate(Tool.OpenWorld, false),
  Tool.make("list_feedback", {
    description:
      "List the feedback reports owned by the account you act for, newest first. Filter by status, kind, or start time and bound the page with limit (1-50, default 20). Each returned record includes the full title and body, so narrow the filters rather than expecting an unbounded page. Another person's reports are never visible, and a report id from another account is reported as not found.",
    parameters: ListFeedbackInput,
    success: Schema.toCodecJson(ListFeedbackResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, feedbackScopes.manage)
    .annotate(Tool.Title, "List feedback")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("triage_feedback", {
    description:
      "Acknowledge, resolve, or close one to ten reports owned by the account you act for. acknowledge moves an open report to acknowledged; resolve closes it with a required note; wontfix closes it as not planned with an optional note. Repeating the same action is an unchanged no-op with the resulting state, and changing a resolved or not-planned report is rejected: close is final, so report the problem again if it returns. A report owned by someone else is not found. Results return each requested action in order with its outcome, current status, and a safe explanation.",
    parameters: TriageFeedbackInput,
    success: Schema.toCodecJson(TriageFeedbackResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, feedbackScopes.manage)
    .annotate(Tool.Title, "Triage feedback")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
);

export function feedbackToolHandlers(
  userId: UserId,
): Layer.Layer<Tool.HandlersFor<Toolkit.Tools<typeof feedbackTools>>, never, Feedback> {
  return feedbackTools.toLayer(
    Effect.gen(function* () {
      const feedback = yield* Feedback;
      const agent = { kind: "agent", reference: "mcp" } as const;
      return feedbackTools.of({
        submit_feedback: (submission) =>
          feedback.submit(userId, agent, [submission]).pipe(
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
          feedback.list(userId, { ...filter, limit: filter.limit ?? 20 }).pipe(
            Effect.map((reports): ListFeedbackResult => ({
              feedback: reports,
              page: { returned: reports.length, limit: filter.limit ?? 20 },
            })),
            mapFailure,
          ),
        triage_feedback: (input) =>
          Effect.gen(function* () {
            if (
              new Set(input.feedback.map((entry) => entry.feedback)).size !== input.feedback.length
            ) {
              return yield* Effect.fail({
                code: "duplicate_feedback",
                message: "Each report may appear once per triage request.",
              });
            }
            const results = yield* feedback.triage(userId, input.feedback).pipe(mapFailure);
            return { results } satisfies TriageFeedbackResult;
          }),
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
