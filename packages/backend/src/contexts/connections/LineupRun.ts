import { Schema } from "effect";

import { TeamId } from "./FantasyTeam.ts";

export const LineupUuid = Schema.String.pipe(Schema.check(Schema.isUUID()));
export type LineupUuid = typeof LineupUuid.Type;

export const LineupRunId = LineupUuid.pipe(Schema.brand("LineupRunId"));
export type LineupRunId = typeof LineupRunId.Type;

export const LineupRequestId = Schema.String.pipe(Schema.check(Schema.isUUID()));
export type LineupRequestId = typeof LineupRequestId.Type;

export const LineupRunStatus = Schema.Literals([
  "queued",
  "reading",
  "planning",
  "validating",
  "applying",
  "verifying",
  "completed",
  "skipped",
  "blocked",
  "retry-wait",
  "failed",
  "uncertain",
  "superseded",
]);
export type LineupRunStatus = typeof LineupRunStatus.Type;

export const LineupTrigger = Schema.Literals(["manual", "scheduled"]);
export type LineupTrigger = typeof LineupTrigger.Type;

export const nativeLineupImplementation = "provider_native" as const;

export const LineupImplementation = Schema.Literals([nativeLineupImplementation]);
export type LineupImplementation = typeof LineupImplementation.Type;

export const providerNativeImplementationVersion = "provider-native/1" as const;

const IsoDate = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)),
  Schema.brand("LineupTargetDate"),
);

export const LineupTargetPeriod = Schema.Union([
  Schema.Struct({
    coverage: Schema.Literal("week"),
    week: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(99)),
  }),
  Schema.Struct({
    coverage: Schema.Literal("date"),
    date: IsoDate,
  }),
]);
export type LineupTargetPeriod = typeof LineupTargetPeriod.Type;

const LineupRequestedTeam = Schema.Struct({
  team: TeamId,
  period: LineupTargetPeriod,
});
type LineupRequestedTeam = typeof LineupRequestedTeam.Type;

export const LineupRequestInput = Schema.Struct({
  requestId: LineupRequestId,
  teams: Schema.Array(LineupRequestedTeam).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(10)),
  ),
});
export type LineupRequestInput = typeof LineupRequestInput.Type;

export const SetLineupInput = Schema.Struct({
  requestId: LineupRequestId,
  teams: LineupRequestInput.fields.teams,
  waitMs: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(20_000)),
  ),
});
export type SetLineupInput = typeof SetLineupInput.Type;

export const GetLineupRunsInput = Schema.Struct({
  runs: Schema.optional(
    Schema.Array(LineupRunId).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(25))),
  ),
  request: Schema.optional(LineupRequestId),
  team: Schema.optional(TeamId),
  limit: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(50)),
  ),
});
export type GetLineupRunsInput = typeof GetLineupRunsInput.Type;

const LineupRunChange = Schema.Struct({
  name: Schema.NonEmptyString,
  from: Schema.NonEmptyString,
  to: Schema.NonEmptyString,
});
type LineupRunChange = typeof LineupRunChange.Type;

const LineupOutcomeKind = Schema.Literals([
  "changed",
  "no_op",
  "blocked",
  "skipped",
  "failed",
  "uncertain",
  "superseded",
]);
type LineupOutcomeKind = typeof LineupOutcomeKind.Type;

export const LineupRunOutcome = Schema.Struct({
  kind: LineupOutcomeKind,
  verified: Schema.Boolean,
  reconciled: Schema.Boolean,
  summary: Schema.String.pipe(Schema.check(Schema.isMaxLength(500))),
  observedAt: Schema.DateTimeUtc,
  changes: Schema.Array(LineupRunChange),
  lockedPlayers: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  editablePlayers: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type LineupRunOutcome = typeof LineupRunOutcome.Type;

export const LineupRun = Schema.Struct({
  run: LineupRunId,
  request: LineupRequestId,
  team: TeamId,
  target: LineupTargetPeriod,
  trigger: LineupTrigger,
  implementation: LineupImplementation,
  implementationVersion: Schema.NonEmptyString,
  status: LineupRunStatus,
  attempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  outcome: Schema.optional(LineupRunOutcome),
  pending: Schema.optional(
    Schema.Struct({
      reason: Schema.NonEmptyString,
      detail: Schema.String,
      retryAt: Schema.optional(Schema.DateTimeUtc),
    }),
  ),
});
export type LineupRun = typeof LineupRun.Type;

export const LineupRunsData = Schema.Struct({
  status: Schema.Literal("ok"),
  runs: Schema.Array(LineupRun),
  observedAt: Schema.DateTimeUtc,
  page: Schema.Struct({
    returned: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    complete: Schema.Boolean,
  }),
});
export type LineupRunsData = typeof LineupRunsData.Type;

export const LineupSubmitData = Schema.Struct({
  request: LineupRequestId,
  delivery: Schema.Literals(["queued", "pending"]),
  runs: Schema.Array(LineupRun),
});
export type LineupSubmitData = typeof LineupSubmitData.Type;

export type LineupError =
  | LineupRequestConflict
  | LineupTeamNotFound
  | LineupConnectionNotReady
  | LineupSelectionInvalid
  | LineupRunNotFound
  | LineupPersistenceFailed;

export class LineupRequestConflict extends Schema.TaggedError<
  LineupRequestConflict,
  { readonly brand: unique symbol }
>()("lineup.request_conflict", {
  request: LineupRequestId,
}) {}

export class LineupTeamNotFound extends Schema.TaggedError<
  LineupTeamNotFound,
  { readonly brand: unique symbol }
>()("lineup.team_not_found", {
  team: TeamId,
}) {}

export class LineupConnectionNotReady extends Schema.TaggedError<
  LineupConnectionNotReady,
  { readonly brand: unique symbol }
>()("lineup.connection_not_ready", {
  team: TeamId,
  status: Schema.Literals(["linking", "ready", "reconnect-required", "disconnected", "missing"]),
}) {}

export class LineupSelectionInvalid extends Schema.TaggedError<
  LineupSelectionInvalid,
  { readonly brand: unique symbol }
>()("lineup.selection_invalid", {
  detail: Schema.String,
}) {}

export class LineupRunNotFound extends Schema.TaggedError<
  LineupRunNotFound,
  { readonly brand: unique symbol }
>()("lineup.run_not_found", {
  run: LineupRunId,
}) {}

export class LineupPersistenceFailed extends Schema.TaggedError<
  LineupPersistenceFailed,
  { readonly brand: unique symbol }
>()("lineup.persistence_failed", {
  cause: Schema.Defect(),
}) {}
