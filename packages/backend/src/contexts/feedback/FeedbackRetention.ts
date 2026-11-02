import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { FeedbackPersistenceFailed } from "./Feedback.ts";

const FeedbackRetentionSummary = Schema.Struct({
  reports: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  quotas: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
type FeedbackRetentionSummary = typeof FeedbackRetentionSummary.Type;

export class FeedbackRetention extends Context.Service<FeedbackRetention, FeedbackRetentionShape>()(
  "@lineupkeep/backend/contexts/feedback/FeedbackRetention",
) {}

export type FeedbackRetentionShape = {
  readonly run: (
    limit: number,
    at: import("effect").DateTime.Utc,
  ) => Effect.Effect<FeedbackRetentionSummary, FeedbackPersistenceFailed>;
};
