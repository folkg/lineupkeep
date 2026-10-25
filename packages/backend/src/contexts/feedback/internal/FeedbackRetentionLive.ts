import { DateTime, Effect, Layer } from "effect";

import {
  FeedbackRetention,
  closedReportRetentionMillis,
  quotaWindowRetentionMillis,
} from "#contexts/feedback/FeedbackRetention.ts";

import { FeedbackRepository } from "./FeedbackRepository.ts";

export const FeedbackRetentionLive = Layer.effect(
  FeedbackRetention,
  Effect.gen(function* () {
    const repository = yield* FeedbackRepository;

    const run = Effect.fn("FeedbackRetention.run")(function* (limit: number, now: DateTime.Utc) {
      const retained = yield* repository.expired({
        closedBefore: DateTime.subtractDuration(now, closedReportRetentionMillis),
        quotasBefore: DateTime.subtractDuration(now, quotaWindowRetentionMillis),
        limit,
      });
      yield* Effect.annotateCurrentSpan({
        "feedback.retention_reports": retained.reports,
        "feedback.retention_quotas": retained.quotas,
      });
      return retained;
    });

    return FeedbackRetention.of({ run });
  }),
);
