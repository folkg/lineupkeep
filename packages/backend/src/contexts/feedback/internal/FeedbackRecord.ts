import { Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import {
  FeedbackContext,
  FeedbackId,
  FeedbackKind,
  FeedbackStatus,
  FeedbackSubmitter,
} from "#contexts/feedback/Feedback.ts";

export const FeedbackRecord = Schema.Struct({
  id: FeedbackId,
  userId: UserId,
  submitter: FeedbackSubmitter,
  kind: FeedbackKind,
  status: FeedbackStatus,
  title: Schema.NonEmptyString,
  body: Schema.NonEmptyString,
  context: FeedbackContext,
  resolutionNote: Schema.optional(Schema.NonEmptyString),
  closedAt: Schema.optional(Schema.DateTimeUtc),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).pipe(Schema.toType);
export type FeedbackRecord = typeof FeedbackRecord.Type;
