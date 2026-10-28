import type { UserId } from "@lineupkeep/backend/auth/User";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

export const FeedbackId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("FeedbackId"),
);
export type FeedbackId = typeof FeedbackId.Type;

export const FeedbackKind = Schema.Literals(["bug", "data-issue", "friction", "wishlist", "other"]);
export type FeedbackKind = typeof FeedbackKind.Type;

export const FeedbackStatus = Schema.Literals(["open", "acknowledged", "resolved", "wontfix"]);
export type FeedbackStatus = typeof FeedbackStatus.Type;

export const FeedbackSubmitterKind = Schema.Literals(["user", "agent"]);
export type FeedbackSubmitterKind = typeof FeedbackSubmitterKind.Type;

export const FeedbackSurface = Schema.Literals([
  "app",
  "teams",
  "team",
  "run",
  "connections",
  "mcp",
]);
export type FeedbackSurface = typeof FeedbackSurface.Type;

export const FeedbackTriageAction = Schema.Literals(["acknowledge", "resolve", "wontfix"]);
export type FeedbackTriageAction = typeof FeedbackTriageAction.Type;

export const feedbackLimits = {
  owner: { window: "1 hour", max: 20 },
  client: { window: "1 hour", max: 10 },
} as const;

const FeedbackTitle = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
);
type FeedbackTitle = typeof FeedbackTitle.Type;

const FeedbackBody = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(4_000)),
);
type FeedbackBody = typeof FeedbackBody.Type;

const FeedbackLabel = Schema.Trim.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(60)));
type FeedbackLabel = typeof FeedbackLabel.Type;

const FeedbackResolutionNote = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(2_000)),
);
type FeedbackResolutionNote = typeof FeedbackResolutionNote.Type;

export const TeamReference = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("TeamReference"),
);
export type TeamReference = typeof TeamReference.Type;

export const FeedbackContext = Schema.Struct({
  tool: Schema.optional(Schema.NullOr(FeedbackLabel)),
  team: Schema.optional(Schema.NullOr(TeamReference)),
  client: Schema.optional(Schema.NullOr(FeedbackLabel)),
  surface: Schema.optional(Schema.NullOr(FeedbackSurface)),
});
export type FeedbackContext = typeof FeedbackContext.Type;

export const FeedbackSubmitter = Schema.Struct({
  kind: FeedbackSubmitterKind,
  reference: FeedbackLabel,
});
export type FeedbackSubmitter = typeof FeedbackSubmitter.Type;

export const FeedbackSubmission = Schema.Struct({
  kind: FeedbackKind,
  title: FeedbackTitle,
  body: FeedbackBody,
  context: Schema.optional(Schema.NullOr(FeedbackContext)),
});
export type FeedbackSubmission = typeof FeedbackSubmission.Type;

export const FeedbackReport = Schema.Struct({
  id: FeedbackId,
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
});
export type FeedbackReport = typeof FeedbackReport.Type;

export const FeedbackFilter = Schema.Struct({
  statuses: Schema.optional(Schema.Array(FeedbackStatus).pipe(Schema.check(Schema.isMinLength(1)))),
  kinds: Schema.optional(Schema.Array(FeedbackKind).pipe(Schema.check(Schema.isMinLength(1)))),
  since: Schema.optional(Schema.DateTimeUtc),
  limit: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(50)),
  ),
});
export type FeedbackFilter = typeof FeedbackFilter.Type;

export const FeedbackTriageInput = Schema.Union([
  Schema.Struct({
    feedback: FeedbackId,
    action: Schema.Literal("acknowledge"),
  }),
  Schema.Struct({
    feedback: FeedbackId,
    action: Schema.Literal("resolve"),
    note: FeedbackResolutionNote,
  }),
  Schema.Struct({
    feedback: FeedbackId,
    action: Schema.Literal("wontfix"),
    note: Schema.optional(FeedbackResolutionNote),
  }),
]);
export type FeedbackTriageInput = typeof FeedbackTriageInput.Type;

const TriagedReport = Schema.Struct({
  feedback: FeedbackReport,
  action: FeedbackTriageAction,
  detail: Schema.NonEmptyString,
});

export const FeedbackTriageResult = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal("changed"), ...TriagedReport.fields }),
  Schema.Struct({ outcome: Schema.Literal("unchanged"), ...TriagedReport.fields }),
  Schema.Struct({
    outcome: Schema.Literal("rejected"),
    ...TriagedReport.fields,
    rejection: Schema.Literal("already-closed"),
  }),
  Schema.Struct({
    outcome: Schema.Literal("not_found"),
    feedback: FeedbackId,
    action: FeedbackTriageAction,
    detail: Schema.NonEmptyString,
  }),
]);
export type FeedbackTriageResult = typeof FeedbackTriageResult.Type;

export class Feedback extends Context.Service<Feedback, FeedbackShape>()(
  "@lineupkeep/backend/contexts/feedback/Feedback",
) {}

export type FeedbackShape = {
  readonly submit: (
    userId: UserId,
    submitter: FeedbackSubmitter,
    submissions: ReadonlyArray<FeedbackSubmission>,
  ) => Effect.Effect<ReadonlyArray<FeedbackReport>, FeedbackSubmitError>;

  readonly list: (
    userId: UserId,
    filter: FeedbackFilter,
  ) => Effect.Effect<ReadonlyArray<FeedbackReport>, FeedbackPersistenceFailed>;

  readonly triage: (
    userId: UserId,
    inputs: ReadonlyArray<FeedbackTriageInput>,
  ) => Effect.Effect<ReadonlyArray<FeedbackTriageResult>, FeedbackTriageError>;
};

type FeedbackSubmitError = FeedbackContentInvalid | FeedbackRateLimited | FeedbackPersistenceFailed;

type FeedbackTriageError = FeedbackContentInvalid | FeedbackPersistenceFailed;

export class FeedbackContentInvalid extends Schema.TaggedError<
  FeedbackContentInvalid,
  { readonly brand: unique symbol }
>()("feedback.content_invalid", {
  detail: Schema.NonEmptyString,
}) {}

export class FeedbackRateLimited extends Schema.TaggedError<
  FeedbackRateLimited,
  { readonly brand: unique symbol }
>()("feedback.rate_limited", {
  retryAfterSeconds: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
}) {}

export class FeedbackPersistenceFailed extends Schema.TaggedError<
  FeedbackPersistenceFailed,
  { readonly brand: unique symbol }
>()("feedback.persistence_failed", {
  cause: Schema.Defect(),
}) {}
