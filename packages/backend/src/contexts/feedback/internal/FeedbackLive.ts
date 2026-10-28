import { DateTime, Effect, Layer, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import {
  Feedback,
  FeedbackContentInvalid,
  FeedbackRateLimited,
  FeedbackSubmission,
  FeedbackTriageInput,
  feedbackLimits,
} from "#contexts/feedback/Feedback.ts";
import type {
  FeedbackFilter,
  FeedbackReport,
  FeedbackSubmission as FeedbackSubmissionType,
  FeedbackSubmitter,
  FeedbackTriageInput as FeedbackTriageInputType,
  FeedbackTriageResult,
} from "#contexts/feedback/Feedback.ts";

import type { FeedbackRecord } from "./FeedbackRecord.ts";
import { FeedbackRepository } from "./FeedbackRepository.ts";
import type { FeedbackTriageRecord } from "./FeedbackRepository.ts";
import { normalizedSubmission, normalizedTriage } from "./FeedbackText.ts";

const windowMillis = 60 * 60 * 1000;
const contentInvalidDetail =
  "A report needs a visible title of at most 120 characters and a body of at most 4000. A resolution note allows up to 2000.";

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

    const triage: Feedback["Service"]["triage"] = Effect.fn("Feedback.triage")(function* (
      userId: UserId,
      inputs: ReadonlyArray<FeedbackTriageInputType>,
    ) {
      const accepted = yield* Effect.forEach(inputs, acceptTriage);
      const records = yield* repository.triage({
        userId,
        triage: accepted,
        at: yield* DateTime.now,
      });
      const results = records.map(toTriageResult);
      yield* Effect.annotateCurrentSpan({
        "feedback.triaged": results.length,
        "feedback.changed": countOutcome(results, "changed"),
        "feedback.unchanged": countOutcome(results, "unchanged"),
        "feedback.rejected": countOutcome(results, "rejected"),
        "feedback.not_found": countOutcome(results, "not_found"),
      });
      return results;
    });

    return Feedback.of({ submit, list, triage });
  }),
);

function acceptSubmission(
  submission: FeedbackSubmissionType,
): Effect.Effect<FeedbackSubmissionType, FeedbackContentInvalid> {
  return Schema.decodeEffect(FeedbackSubmission)(normalizedSubmission(submission)).pipe(
    Effect.mapError(() => FeedbackContentInvalid.make({ detail: contentInvalidDetail })),
  );
}

function acceptTriage(
  input: FeedbackTriageInputType,
): Effect.Effect<FeedbackTriageInputType, FeedbackContentInvalid> {
  return Schema.decodeEffect(FeedbackTriageInput)(normalizedTriage(input)).pipe(
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

function toTriageResult(record: FeedbackTriageRecord): FeedbackTriageResult {
  if (record.outcome === "not_found") {
    return {
      outcome: "not_found",
      feedback: record.feedback,
      action: record.action,
      detail: "The selected report is not available to this account. List your reports again.",
    };
  }
  const feedback = toFeedbackReport(record.feedback);
  switch (record.outcome) {
    case "changed":
      return {
        outcome: "changed",
        feedback,
        action: record.action,
        detail: changedDetail(record.action),
      };
    case "unchanged":
      return {
        outcome: "unchanged",
        feedback,
        action: record.action,
        detail: unchangedDetail(record.action),
      };
    case "rejected":
      return {
        outcome: "rejected",
        feedback,
        action: record.action,
        rejection: "already-closed",
        detail:
          "A resolved or not-planned report is final. Report the problem again if it returns.",
      };
  }
}

function changedDetail(action: FeedbackTriageResult["action"]): string {
  switch (action) {
    case "acknowledge":
      return "The report is acknowledged.";
    case "resolve":
      return "The report is resolved with its note.";
    case "wontfix":
      return "The report is closed as not planned.";
  }
}

function unchangedDetail(action: FeedbackTriageResult["action"]): string {
  switch (action) {
    case "acknowledge":
      return "The report is already acknowledged.";
    case "resolve":
      return "The report is already resolved; its existing note is unchanged.";
    case "wontfix":
      return "The report is already closed as not planned.";
  }
}

function countOutcome(
  results: ReadonlyArray<FeedbackTriageResult>,
  outcome: FeedbackTriageResult["outcome"],
): number {
  return results.filter((result) => result.outcome === outcome).length;
}
