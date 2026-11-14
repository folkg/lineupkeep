import { Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { FantasyLeague, FantasySport, TeamId } from "#contexts/connections/FantasyTeam.ts";

const LineupgradeId = Schema.Union([
  Schema.String.pipe(Schema.check(Schema.isUUID())),
  Schema.String.pipe(Schema.check(Schema.isULID())),
]);

export const TransactionMoveId = LineupgradeId.pipe(Schema.brand("TransactionMoveId"));
export type TransactionMoveId = typeof TransactionMoveId.Type;

export const TransactionMoveKind = Schema.Literals([
  "free_agent_add",
  "waiver_claim",
  "drop",
  "trade",
  "activate",
  "stash",
  "slot_move",
]);
export type TransactionMoveKind = typeof TransactionMoveKind.Type;

export const TransactionMoveDecision = Schema.Literals(["undecided", "saved", "now", "discarded"]);
export type TransactionMoveDecision = typeof TransactionMoveDecision.Type;

export const TransactionMoveValidationStatus = Schema.Literals([
  "unchecked",
  "current",
  "stale",
  "illegal",
]);
export type TransactionMoveValidationStatus = typeof TransactionMoveValidationStatus.Type;

export const TransactionMoveResult = Schema.Literals([
  "executed",
  "pending",
  "failed",
  "skipped",
  "unknown",
  "withdrawn",
  "expired",
]);
export type TransactionMoveResult = typeof TransactionMoveResult.Type;

const TransactionMoveClaimKind = Schema.Literals(["player", "place", "draft_pick"]);

export const TransactionMoveReadState = Schema.Literals(["open", "today", "saved", "ended"]);
export type TransactionMoveReadState = typeof TransactionMoveReadState.Type;

export const TransactionMoveTeam = Schema.Struct({
  id: TeamId,
  name: Schema.NonEmptyString,
  league: FantasyLeague,
  sport: FantasySport,
  season: Schema.Int.check(Schema.isGreaterThan(1900)),
}).pipe(Schema.toType);
export type TransactionMoveTeam = typeof TransactionMoveTeam.Type;

export function isOpenMove(move: {
  readonly decision: TransactionMoveDecision;
  readonly result?: TransactionMoveResult;
}): boolean {
  return (
    move.decision !== "discarded" &&
    move.result !== "executed" &&
    move.result !== "withdrawn" &&
    move.result !== "expired"
  );
}

export const StoredMoveDate = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)),
);
export type StoredMoveDate = typeof StoredMoveDate.Type;

export const StoredMovePlayer = Schema.Struct({
  key: Schema.NonEmptyString,
  name: Schema.optional(Schema.NonEmptyString),
  position: Schema.optional(Schema.NonEmptyString),
  proTeam: Schema.optional(Schema.NonEmptyString),
  availability: Schema.optional(Schema.NonEmptyString),
});
export type StoredMovePlayer = typeof StoredMovePlayer.Type;

export const StoredMovePick = Schema.Struct({
  round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  sourceTeamKey: Schema.NonEmptyString,
  destinationTeamKey: Schema.NonEmptyString,
  sourceName: Schema.NonEmptyString,
  destinationName: Schema.NonEmptyString,
});
export type StoredMovePick = typeof StoredMovePick.Type;

export const StoredMoveSlot = Schema.Struct({
  playerKey: Schema.NonEmptyString,
  playerName: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.NonEmptyString,
});
export type StoredMoveSlot = typeof StoredMoveSlot.Type;

export const StoredMoveIntent = Schema.Struct({
  kind: Schema.Literals(["add", "activate", "stash"]),
  player: Schema.optional(StoredMovePlayer),
  to: Schema.optional(Schema.Literals(["active", "reserve"])),
});
export type StoredMoveIntent = typeof StoredMoveIntent.Type;

export const StoredMovePlacement = Schema.Struct({
  playerKey: Schema.NonEmptyString,
  playerName: Schema.optional(Schema.NonEmptyString),
  fromSlot: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.NonEmptyString,
  detail: Schema.NonEmptyString,
});
export type StoredMovePlacement = typeof StoredMovePlacement.Type;

export const StoredMoveValidationReason = Schema.Struct({
  code: Schema.NonEmptyString,
  playerKey: Schema.optional(Schema.NonEmptyString),
  detail: Schema.NonEmptyString,
});
export type StoredMoveValidationReason = typeof StoredMoveValidationReason.Type;

export const StoredMoveValidation = Schema.Struct({
  status: TransactionMoveValidationStatus,
  checkedAt: Schema.optional(Schema.DateTimeUtc),
  reasons: Schema.Array(StoredMoveValidationReason),
});
export type StoredMoveValidation = typeof StoredMoveValidation.Type;

export const StoredMoveClaim = Schema.Struct({
  kind: TransactionMoveClaimKind,
  key: Schema.NonEmptyString,
});
export type StoredMoveClaim = typeof StoredMoveClaim.Type;

export const TransactionMoveProvenance = Schema.Struct({
  kind: Schema.Literals(["user", "agent"]),
  reference: Schema.NonEmptyString,
  surface: Schema.Literals(["app", "mcp"]),
  client: Schema.optional(Schema.NonEmptyString),
});
export type TransactionMoveProvenance = typeof TransactionMoveProvenance.Type;

export const TransactionMoveCursor = Schema.Struct({
  runDay: Schema.NullOr(StoredMoveDate),
  team: TeamId,
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  move: TransactionMoveId,
});
export type TransactionMoveCursor = typeof TransactionMoveCursor.Type;

export const TransactionMovePageLimit = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(50),
);
export type TransactionMovePageLimit = typeof TransactionMovePageLimit.Type;

export const TransactionPlanRecord = Schema.Struct({
  userId: UserId,
  team: TeamId,
  runClaim: Schema.optional(Schema.NonEmptyString),
  runClaimedAt: Schema.optional(Schema.DateTimeUtc),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).pipe(Schema.toType);
export type TransactionPlanRecord = typeof TransactionPlanRecord.Type;

const TransactionMoveFields = {
  id: TransactionMoveId,
  userId: UserId,
  team: TeamId,
  group: Schema.optional(Schema.NonEmptyString),
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  runPosition: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  kind: TransactionMoveKind,
  adds: Schema.Array(StoredMovePlayer),
  fallbacks: Schema.Array(StoredMovePlayer),
  drops: Schema.Array(StoredMovePlayer),
  picks: Schema.Array(StoredMovePick),
  slotMove: Schema.optional(StoredMoveSlot),
  intent: Schema.optional(StoredMoveIntent),
  placement: Schema.optional(StoredMovePlacement),
  counterpartyKey: Schema.optional(Schema.NonEmptyString),
  externalRef: Schema.optional(Schema.NonEmptyString),
  bid: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  reason: Schema.NonEmptyString,
  runDay: Schema.optional(StoredMoveDate),
  effectiveDate: Schema.optional(StoredMoveDate),
  decision: TransactionMoveDecision,
  decidedAt: Schema.optional(Schema.DateTimeUtc),
  validation: StoredMoveValidation,
  result: Schema.optional(TransactionMoveResult),
  resultDetail: Schema.optional(Schema.NonEmptyString),
  resultAt: Schema.optional(Schema.DateTimeUtc),
  proposedBy: TransactionMoveProvenance,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
};

export const TransactionMoveRowRecord = Schema.Struct(TransactionMoveFields).pipe(Schema.toType);
export type TransactionMoveRowRecord = typeof TransactionMoveRowRecord.Type;

export const TransactionMoveRecord = Schema.Struct({
  ...TransactionMoveFields,
  claims: Schema.Array(StoredMoveClaim),
}).pipe(Schema.toType);
export type TransactionMoveRecord = typeof TransactionMoveRecord.Type;

export class TransactionPlanPersistenceFailed extends Schema.TaggedError<
  TransactionPlanPersistenceFailed,
  { readonly brand: unique symbol }
>()("transaction_plan.persistence_failed", {
  cause: Schema.Defect(),
}) {}
