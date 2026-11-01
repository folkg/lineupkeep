import { DateTime, Effect, Layer, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import {
  Feedback,
  FeedbackContentInvalid,
  FeedbackRateLimited,
  FeedbackSubmission,
  feedbackLimits,
} from "#contexts/feedback/Feedback.ts";
import type {
  FeedbackFilter,
  FeedbackReport,
  FeedbackSubmission as FeedbackSubmissionType,
  FeedbackSubmitter,
} from "#contexts/feedback/Feedback.ts";

import type { FeedbackRecord } from "./FeedbackRecord.ts";
import { FeedbackRepository } from "./FeedbackRepository.ts";
import { normalizedSubmission } from "./FeedbackText.ts";

const windowMillis = 60 * 60 * 1000;
const contentInvalidDetail =
  "A report needs a visible title of at most 120 characters and a body of at most 4000.";

export const FeedbackLive = Layer.effect(
  Feedback,
  Effect.gen(function* () {
    const repository = yield* FeedbackRepository;

    const submit: Feedback["Service"]["submit"] = Effect.fn("Feedback.submit")(function* (
      userId: UserId,
      submitter: FeedbackSubmitter,
      submissions: ReadonlyArray<FeedbackSubmissionType>,
    ) {
      if (submissions.length === 0) {
        return [];
      }
      const accepted = yield* Effect.forEach(submissions, acceptSubmission);
      const now = yield* DateTime.now;
      const windowStartedAt = DateTime.makeUnsafe(
        Math.floor(DateTime.toEpochMillis(now) / windowMillis) * windowMillis,
      );
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil(
          (DateTime.toEpochMillis(windowStartedAt) + windowMillis - DateTime.toEpochMillis(now)) /
            1000,
        ),
      );
      const client = accepted[0]?.context?.client;
      const clientReference =
        client === null || client === undefined
          ? submitter.reference
          : `${submitter.reference}:${client}`;
      const window = String(DateTime.toEpochMillis(windowStartedAt));
      const reserved = yield* repository.reserve([
        {
          key: `owner:${userId}:${window}`,
          amount: accepted.length,
          limit: feedbackLimits.owner.max,
          windowStartedAt,
        },
        {
          key: `client:${userId}:${clientReference}:${window}`,
          amount: accepted.length,
          limit: feedbackLimits.client.max,
          windowStartedAt,
        },
      ]);
      if (!reserved) {
        yield* Effect.annotateCurrentSpan({
          "app.outcome": "rejected",
          "feedback.outcome": "rate_limited",
        });
        return yield* FeedbackRateLimited.make({ retryAfterSeconds });
      }
      const records = yield* repository.create({
        userId,
        submitter,
        submissions: accepted,
        at: now,
      });
      yield* Effect.annotateCurrentSpan({
        "feedback.submitted": records.length,
        "feedback.submitter_kind": submitter.kind,
      });
      return records.map(toFeedbackReport);
    });

    const list: Feedback["Service"]["list"] = Effect.fn("Feedback.list")(function* (
      userId: UserId,
      filter: FeedbackFilter,
    ) {
      const records = yield* repository.list({ userId, filter });
      yield* Effect.annotateCurrentSpan({ "feedback.listed": records.length });
      return records.map(toFeedbackReport);
    });

    return Feedback.of({ submit, list });
  }),
);

function acceptSubmission(
  submission: FeedbackSubmissionType,
): Effect.Effect<FeedbackSubmissionType, FeedbackContentInvalid> {
  return Schema.decodeEffect(FeedbackSubmission)(normalizedSubmission(submission)).pipe(
    Effect.mapError(() => FeedbackContentInvalid.make({ detail: contentInvalidDetail })),
  );
}

function toFeedbackReport(record: FeedbackRecord): FeedbackReport {
  return {
    id: record.id,
    submitter: record.submitter,
    kind: record.kind,
    status: record.status,
    title: record.title,
    body: record.body,
    context: record.context,
    ...(record.resolutionNote === undefined ? {} : { resolutionNote: record.resolutionNote }),
    ...(record.closedAt === undefined ? {} : { closedAt: record.closedAt }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
