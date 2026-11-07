import type { UserId } from "@lineupkeep/backend/auth/User";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

const LineupgradeId = Schema.Union([
  Schema.String.pipe(Schema.check(Schema.isUUID())),
  Schema.String.pipe(Schema.check(Schema.isULID())),
]);

export const FeedbackId = LineupgradeId.pipe(Schema.brand("FeedbackId"));
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

export const TeamReference = LineupgradeId.pipe(Schema.brand("TeamReference"));
export type TeamReference = typeof TeamReference.Type;

export const FeedbackContext = Schema.Struct({
  tool: Schema.optional(FeedbackLabel),
  team: Schema.optional(TeamReference),
  client: Schema.optional(FeedbackLabel),
  surface: Schema.optional(FeedbackSurface),
});
export type FeedbackContext = typeof FeedbackContext.Type;

const FeedbackContextInput = Schema.Struct({
  tool: Schema.optional(Schema.NullOr(FeedbackLabel)),
  team: Schema.optional(Schema.NullOr(TeamReference)),
  client: Schema.optional(Schema.NullOr(FeedbackLabel)),
  surface: Schema.optional(Schema.NullOr(FeedbackSurface)),
});
export type FeedbackContextInput = typeof FeedbackContextInput.Type;

export const FeedbackSubmitter = Schema.Struct({
  kind: FeedbackSubmitterKind,
  reference: FeedbackLabel,
});
export type FeedbackSubmitter = typeof FeedbackSubmitter.Type;

export const FeedbackSubmission = Schema.Struct({
  kind: FeedbackKind,
  title: FeedbackTitle,
  body: FeedbackBody,
  context: Schema.optional(Schema.NullOr(FeedbackContextInput)),
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
  since: Schema.optional(
    Schema.DateTimeUtcFromString.pipe(
      Schema.annotate({
        description:
          "Only reports created at or after this ISO 8601 instant, for example `2026-09-20T00:00:00Z`. An offset form such as `2026-09-20T00:00:00-04:00` is also accepted.",
      }),
    ),
  ),
  limit: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(50)),
  ),
});
export type FeedbackFilter = typeof FeedbackFilter.Type;

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
};

type FeedbackSubmitError = FeedbackContentInvalid | FeedbackRateLimited | FeedbackPersistenceFailed;

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
